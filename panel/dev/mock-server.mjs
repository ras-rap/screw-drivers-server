#!/usr/bin/env node
/**
 * Fake ModTheIsland admin server for panel development: implements the endpoints the
 * panel uses so a second/third "server" can be simulated without a game instance.
 *
 *   node dev/mock-server.mjs --port 38091 --token mock-token --name "Mock #2"
 */
import { createServer } from "node:http";

const args = new Map(
  process.argv
    .slice(2)
    .reduce((pairs, item, index, all) => (index % 2 === 0 ? [...pairs, [item, all[index + 1]]] : pairs), []),
);
const port = Number(args.get("--port") ?? 38091);
const token = args.get("--token") ?? "mock-token";
const name = args.get("--name") ?? "Mock server";
const unsaved = args.has("--unsaved");

const started = Date.now();
const chat = [];
let seq = 0;
const bans = [];
const players = [
  { playerId: 3, name: "MockPlayer", steamId: "76561190000000042", endpoint: "10.0.0.99:40000", ping: 24, idleSeconds: 2, isHost: true },
];

// Only the sections the panel's Mod tab needs to be exercised: an auto-ban switch with a
// numeric companion, so a Boolean round-trip and a type rejection are both reachable.
let autoBanEnabled = true;
let autoBanStrikes = 25;

function configSections() {
  return [
    {
      name: "AutoBan",
      restart: false,
      entries: [
        {
          key: "Enabled",
          type: "bool",
          value: autoBanEnabled,
          description: "Master switch for every automatic ban.",
          sensitive: false,
        },
        {
          key: "Strikes",
          type: "int",
          value: autoBanStrikes,
          description: "Offences needed inside the window before an endpoint is banned.",
          sensitive: false,
        },
      ],
    },
  ];
}

function status() {
  return {
    ok: true,
    gameVersion: "v1.2.12",
    serverName: name,
    scene: "Server",
    uptimeSeconds: Math.floor((Date.now() - started) / 1000),
    port: port + 1000,
    maxPlayers: 8,
    currentPlayers: players.length,
    hasPassword: false,
    nobleConnect: false,
    host: { playerId: players[0]?.playerId ?? 255, steamId: players[0]?.steamId ?? null },
    hostSettings: {
      damagePercentage: 100,
      maxAcceleration: 200,
      downforceAllowed: true,
      repairingAllowed: true,
      mapVoteAtEnd: true,
      playMode: 1,
      amountOfRounds: 5,
    },
    bans: { steam: 0, ip: 0, endpoint: bans.filter((ban) => ban.state === "banned").length, endpointWindowMinutes: 60 },
    chatLastSeq: seq,
  };
}

function addChat(kind, who, message) {
  seq += 1;
  chat.push({ seq, time: new Date().toISOString(), kind, playerId: players[0]?.playerId ?? -1, name: who, steamId: null, message });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;
  const json = (status_, body) => {
    response.writeHead(status_, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };

  if (path === "/health") return json(200, { ok: true, loaded: true });
  if (request.headers.authorization !== `Bearer ${token}`) return json(401, { ok: false, error: "bad token" });

  let body = {};
  if (request.method === "POST" || request.method === "DELETE") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.length > 0) body = JSON.parse(raw);
  }

  if (path === "/status") return json(200, status());
  if (path === "/players") return json(200, { ok: true, players });
  if (path === "/bans" && request.method === "GET") return json(200, { ok: true, windowMinutes: 60, bans });
  if (path === "/bans" && request.method === "POST") {
    bans.push({ scope: body.scope, target: body.target, state: "banned", reason: body.reason ?? "", expires: "permanent" });
    return json(200, { ok: true });
  }
  if (path === "/bans" && request.method === "DELETE") {
    const index = bans.findIndex((ban) => ban.scope === body.scope && ban.target === body.target);
    if (index >= 0) bans.splice(index, 1);
    return json(200, { ok: true, removed: index >= 0 });
  }
  if (path === "/islands") {
    return json(200, { ok: true, current: 111, islands: [{ uniqueId: 111, sortOrder: 0 }, { uniqueId: 222, sortOrder: 1 }] });
  }
  if (path === "/chat") {
    const since = Number(url.searchParams.get("since") ?? 0);
    return json(200, { ok: true, lastSeq: seq, entries: chat.filter((line) => line.seq > since) });
  }
  if (path === "/say") {
    addChat("server", "server", String(body.message ?? ""));
    return json(200, { ok: true });
  }
  if (path === "/kick") {
    const index = players.findIndex((player) => player.playerId === body.playerId);
    if (index < 0) return json(400, { ok: false, error: "no such player" });
    const [kicked] = players.splice(index, 1);
    addChat("player", kicked.name, "was kicked");
    return json(200, { ok: true });
  }
  if (path === "/settings" || path === "/hostsettings") {
    // The real mod answers "saved" after it captured the new values into its snapshot;
    // --unsaved simulates SaveOnChange=false so the panel's warning path is reachable.
    return json(200, { ok: true, saved: !unsaved });
  }
  if (path === "/command" || path === "/gamestate" || path === "/host" || path === "/island" || path === "/dm") {
    return json(200, { ok: true });
  }
  if (path === "/config" && request.method === "GET") return json(200, { ok: true, sections: configSections() });
  if (path === "/config" && request.method === "POST") {
    const entry = configSections()
      .find((section) => section.name === body.section)
      ?.entries.find((candidate) => candidate.key === body.key);
    if (!entry) return json(400, { ok: false, applied: [], restartRequired: [], errors: [`no such setting ${body.section}/${body.key}`] });
    if (entry.type === "bool") {
      if (body.value !== "true" && body.value !== "false") {
        return json(400, { ok: false, applied: [], restartRequired: [], errors: [`${body.key} is true or false`] });
      }
      if (body.key === "Enabled") autoBanEnabled = body.value === "true";
    } else {
      const number = Number(body.value);
      if (!Number.isInteger(number) || number < 0) {
        return json(400, { ok: false, applied: [], restartRequired: [], errors: [`${body.key} is a whole number >= 0`] });
      }
      if (body.key === "Strikes") autoBanStrikes = number;
    }
    return json(200, { ok: true, applied: [`${body.section}/${body.key}`], restartRequired: [], errors: [] });
  }
  if (path === "/restart" || path === "/stop") return json(200, { ok: true, action: path.slice(1) });
  return json(404, { ok: false, error: `mock: no ${path}` });
});

server.listen(port, () => {
  console.log(`[mock] ${name} on http://127.0.0.1:${port} token=${token}`);
});
