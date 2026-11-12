#!/usr/bin/env node
/**
 * Fake Pterodactyl **application** API for panel development:
 *
 *   node dev/mock-pterodactyl.mjs --port 39001 --key ptla_test --admin-port 38091
 *
 * It advertises two servers on one node, both with a single allocation that the panel
 * should use as the admin port, and logs every power signal it receives.
 */
import { createServer } from "node:http";

const args = new Map(
  process.argv
    .slice(2)
    .reduce((pairs, item, index, all) => (index % 2 === 0 ? [...pairs, [item, all[index + 1]]] : pairs), []),
);
const port = Number(args.get("--port") ?? 39001);
const key = args.get("--key") ?? "ptla_test";
const adminPort = Number(args.get("--admin-port") ?? 38091);
const nodeIp = args.get("--ip") ?? "0.0.0.0";

const servers = [
  {
    id: 12,
    identifier: "ptero12ab",
    name: "Ptero EU #1",
    status: "running",
    node: 1,
    relationships: {
      allocations: { data: [{ attributes: { ip: nodeIp, port: adminPort, ip_alias: null } }] },
    },
  },
  {
    id: 13,
    identifier: "ptero34cd",
    name: "Ptero US #2",
    status: "offline",
    node: 2,
    relationships: {
      allocations: { data: [{ attributes: { ip: nodeIp, port: adminPort + 1, ip_alias: null } }] },
    },
  },
];

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body === undefined ? "" : JSON.stringify(body));
  };

  if (request.headers.authorization !== `Bearer ${key}`) {
    return send(403, { errors: [{ code: "Forbidden", status: "403" }] });
  }

  if (request.method === "GET" && url.pathname === "/api/application/servers") {
    return send(200, { object: "list", data: servers.map((attributes) => ({ object: "server", attributes })) });
  }

  const single = url.pathname.match(/^\/api\/application\/servers\/(\d+)$/);
  if (request.method === "GET" && single) {
    const found = servers.find((entry) => entry.id === Number(single[1]));
    if (!found) return send(404, { errors: [{ code: "NotFound", status: "404" }] });
    return send(200, { object: "server", attributes: found });
  }

  const power = url.pathname.match(/^\/api\/application\/servers\/(\d+)\/power$/);
  if (request.method === "POST" && power) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const target = servers.find((entry) => entry.id === Number(power[1]));
    if (target) target.status = body.signal === "stop" || body.signal === "kill" ? "offline" : "running";
    console.log(`[pterodactyl-mock] power ${body.signal} → server ${power[1]} (now ${target?.status ?? "?"})`);
    return send(204);
  }

  send(404, { errors: [{ code: "NotFound", status: "404" }] });
});

server.listen(port, () => {
  console.log(`[pterodactyl-mock] http://127.0.0.1:${port} key=${key} node ${nodeIp} admin ports ${adminPort}/${adminPort + 1}`);
});
