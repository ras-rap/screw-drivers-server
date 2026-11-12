"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  panelFetch,
  type PanelBan,
  type PanelChatLine,
  type PanelIsland,
  type PanelPlayer,
  type PanelSettingSection,
  type PanelStatus,
} from "@/lib/client";
import { toast } from "./Toaster";
import { usePolling } from "./usePolling";

type Tab = "players" | "chat" | "server" | "bans" | "mod" | "console";

const TABS: { key: Tab; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "chat", label: "Chat" },
  { key: "server", label: "Server" },
  { key: "bans", label: "Bans" },
  { key: "mod", label: "Mod settings" },
  { key: "console", label: "Console" },
];

function uptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function relative(iso: string): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "?";
  const minutes = Math.round((at - Date.now()) / 60000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
}

/** One server: status bar plus players / chat / settings / bans / console tabs. */
export function ServerView({ id, name }: { id: string; name: string }) {
  const [tab, setTab] = useState<Tab>("players");
  const base = `/api/s/${id}`;
  const status = usePolling<PanelStatus>(`${base}/status`, 4000);
  const players = usePolling<{ players: PanelPlayer[] }>(`${base}/players`, 4000);

  async function post(path: string, body?: unknown): Promise<boolean> {
    try {
      await panelFetch(`${base}/${path}`, { method: "POST", body: body ?? {} });
      void status.reload();
      void players.reload();
      return true;
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
      return false;
    }
  }

  const state = status.data;
  const online = state !== null && status.error === null;

  return (
    <>
      <div className="topbar">
        <Link className="badge" href="/">
          ← all servers
        </Link>
        <h1>{name}</h1>
        <span className={`dot ${online ? "ok" : "bad"}`} />
        <span className="muted mono">
          {state ? `${state.currentPlayers}/${state.maxPlayers} · ${state.port}/udp · ${uptime(state.uptimeSeconds)}` : "…"}
        </span>
        <span className="spacer" />
        <button
          className="warn"
          onClick={() => {
            if (confirm("Restart this server?")) void post("restart", { delaySeconds: 1 }).then((ok) => ok && toast("restart requested", "ok"));
          }}
        >
          Restart
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm("Stop this server? It stays down until started again."))
              void post("stop", { delaySeconds: 1 }).then((ok) => ok && toast("stop requested", "ok"));
          }}
        >
          Stop
        </button>
      </div>

      <main className="page">
        {status.error ? <p className="card down" style={{ marginBottom: 12 }}>{status.error}</p> : null}

        <div className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              className={tab === entry.key ? "active" : ""}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "players" ? (
          <PlayersTab
            players={players.data?.players ?? []}
            hostId={state?.host.playerId ?? 255}
            onKick={(playerId) => void post("kick", { playerId, reason: "Kicked from panel" })}
            onHost={(playerId) => void post("host", { playerId }).then((ok) => ok && toast("host changed", "ok"))}
            onBan={(player) => {
              if (!confirm(`Ban ${player.name}? SteamID permanently, endpoint for 60 minutes.`)) return;
              void (async () => {
                if (player.steamId) await post("bans", { scope: "steam", target: player.steamId, minutes: 0, reason: "banned from panel" });
                await post("bans", { scope: "endpoint", target: player.endpoint, minutes: 60, reason: "banned from panel" });
                await post("kick", { playerId: player.playerId, reason: "Banned from panel" });
                toast(`banned ${player.name}`, "ok");
              })();
            }}
            onDm={(player) => {
              const message = prompt(`Message to ${player.name}`);
              if (message) void post("dm", { playerId: player.playerId, message }).then((ok) => ok && toast("sent", "ok"));
            }}
          />
        ) : null}

        {tab === "chat" ? <ChatTab id={id} /> : null}
        {tab === "server" ? <ServerTab id={id} status={state} post={post} /> : null}
        {tab === "bans" ? <BansTab id={id} post={post} /> : null}
        {tab === "mod" ? <ModTab id={id} /> : null}
        {tab === "console" ? <ConsoleTab post={post} status={state} /> : null}
      </main>
    </>
  );
}

function PlayersTab({
  players,
  hostId,
  onKick,
  onHost,
  onBan,
  onDm,
}: {
  players: PanelPlayer[];
  hostId: number;
  onKick: (playerId: number) => void;
  onHost: (playerId: number) => void;
  onBan: (player: PanelPlayer) => void;
  onDm: (player: PanelPlayer) => void;
}) {
  return (
    <section className="card">
      <h2>Players</h2>
      <div className="sub">{players.length === 0 ? "nobody connected" : `${players.length} connected`}</div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>SteamID</th>
            <th>Endpoint</th>
            <th>Ping</th>
            <th>Idle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {players.length === 0 ? (
            <tr>
              <td className="empty" colSpan={7}>
                no players connected
              </td>
            </tr>
          ) : (
            players.map((player) => (
              <tr key={player.playerId}>
                <td>{player.playerId}</td>
                <td>
                  {player.name}
                  {player.playerId === hostId ? <span className="badge host"> host</span> : null}
                  {player.isAdmin ? <span className="badge ok"> admin</span> : null}
                  {player.banned ? <span className="badge banned"> banned</span> : null}
                </td>
                <td className="mono muted">
                  <span className="trunc" title={player.steamId ?? ""}>
                    {player.steamId ?? "—"}
                  </span>
                </td>
                <td className="mono muted">{player.endpoint}</td>
                <td>{player.ping}</td>
                <td>{Math.round(player.idleSeconds)}s</td>
                <td className="actions">
                  <button className="mini ghost" onClick={() => onDm(player)}>
                    DM
                  </button>{" "}
                  <button className="mini ghost" onClick={() => onHost(player.playerId)}>
                    Host
                  </button>{" "}
                  <button className="mini ghost" onClick={() => onBan(player)}>
                    Ban
                  </button>{" "}
                  <button className="mini danger" onClick={() => confirm(`Kick ${player.name}?`) && onKick(player.playerId)}>
                    Kick
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

function ChatTab({ id }: { id: string }) {
  const [lines, setLines] = useState<PanelChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const log = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const data = await panelFetch<{ entries: PanelChatLine[]; lastSeq: number }>(
          `/api/s/${id}/chat?since=${cursor.current}&limit=200`,
        );
        if (!alive) return;
        cursor.current = data.lastSeq;
        if (data.entries.length === 0) return;
        setLines((current) => [...current, ...data.entries].slice(-300));
        setError(null);
      } catch (problem) {
        if (alive) setError(problem instanceof Error ? problem.message : String(problem));
      }
    }, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <section className="card">
      <h2>Chat</h2>
      <div className="sub">{error ?? "live feed, newest last"}</div>
      <div className="chat" ref={log}>
        {lines.map((line) => (
          <div key={line.seq} className="line">
            <span className="time">{new Date(line.time).toLocaleTimeString()}</span>
            <span className={`who ${line.kind}`}>{line.name ?? line.kind}</span>
            <span className="msg">{line.message}</span>
          </div>
        ))}
      </div>
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const message = draft.trim();
          if (!message) return;
          try {
            await panelFetch(`/api/s/${id}/say`, { method: "POST", body: { message } });
            setDraft("");
          } catch (problem) {
            toast(problem instanceof Error ? problem.message : String(problem), "err");
          }
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="say something to everyone…" />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}

function ServerTab({
  id,
  status,
  post,
}: {
  id: string;
  status: PanelStatus | null;
  post: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const [name, setName] = useState(status?.serverName ?? "");
  const [password, setPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(status?.maxPlayers ?? 8);
  const [islands, setIslands] = useState<PanelIsland[]>([]);
  const [currentIsland, setCurrentIsland] = useState<number | null>(null);
  const [island, setIsland] = useState<number | null>(null);

  useEffect(() => {
    if (status) {
      setName(status.serverName);
      setMaxPlayers(status.maxPlayers);
    }
  }, [status?.serverName, status?.maxPlayers]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await panelFetch<{ current: number; islands: PanelIsland[] }>(`/api/s/${id}/islands`);
        if (!alive) return;
        setIslands(data.islands);
        setCurrentIsland(data.current);
        setIsland(data.current);
      } catch {
        /* the island list needs a loaded server; quiet failure is fine */
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const rules = status?.hostSettings;

  return (
    <div className="stack">
      <section className="card">
        <h2>Server</h2>
        <div className="sub">name, join password and slot count</div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            const body: Record<string, unknown> = { name, maxPlayers };
            if (password.length > 0) body.password = password;
            if (await post("settings", body)) {
              setPassword("");
              toast("settings applied", "ok");
            }
          }}
        >
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
          </label>
          <label>
            Password (empty = unchanged)
            <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Max players
            <input
              type="number"
              min={1}
              max={32}
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(Number(event.target.value))}
            />
          </label>
          <div className="row end">
            <button type="button" className="ghost" onClick={() => void post("settings", { password: "" }).then((ok) => ok && toast("password cleared", "ok"))}>
              Clear password
            </button>
            <button type="submit">Apply</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Race rules</h2>
        <div className="sub">what the in-game host sets for the next race</div>
        {rules ? (
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const body = {
                damagePercentage: Number(form.get("damage") ?? 100),
                maxAcceleration: Number(form.get("accel") ?? 200),
                playMode: Number(form.get("playmode") ?? 1),
                amountOfRounds: Number(form.get("rounds") ?? 5),
                downforceAllowed: form.get("downforce") === "on",
                repairingAllowed: form.get("repair") === "on",
                mapVoteAtEnd: form.get("votemap") === "on",
              };
              if (await post("hostsettings", body)) toast("race rules applied", "ok");
            }}
          >
            <label>
              Damage %
              <input name="damage" type="number" min={0} max={100} defaultValue={rules.damagePercentage} />
            </label>
            <label>
              Max acceleration
              <input name="accel" type="number" defaultValue={rules.maxAcceleration} />
            </label>
            <label>
              Play mode
              <input name="playmode" type="number" min={0} max={255} defaultValue={rules.playMode} />
            </label>
            <label>
              Rounds
              <input name="rounds" type="number" min={0} max={255} defaultValue={rules.amountOfRounds} />
            </label>
            <label className="check">
              <input name="downforce" type="checkbox" defaultChecked={rules.downforceAllowed} /> downforce
            </label>
            <label className="check">
              <input name="repair" type="checkbox" defaultChecked={rules.repairingAllowed} /> repairing
            </label>
            <label className="check">
              <input name="votemap" type="checkbox" defaultChecked={rules.mapVoteAtEnd} /> map vote at end
            </label>
            <div className="row end">
              <button type="submit">Apply</button>
            </div>
          </form>
        ) : (
          <p className="muted">server not reachable</p>
        )}
      </section>

      <section className="card">
        <h2>World</h2>
        <div className="sub">
          current island {currentIsland ?? "?"} · switch it or start the ready-up like the host would
        </div>
        <div className="row">
          <select value={island ?? ""} onChange={(event) => setIsland(Number(event.target.value))} style={{ maxWidth: 320 }}>
            {islands.map((entry) => (
              <option key={entry.uniqueId} value={entry.uniqueId}>
                {entry.name ?? `island ${entry.uniqueId}`} (#{entry.sortOrder})
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (island === null) return;
              if (await post("island", { uniqueId: island })) {
                setCurrentIsland(island);
                toast("island switched", "ok");
              }
            }}
          >
            Switch island
          </button>
          <button onClick={() => void post("gamestate", { state: "waiting" }).then((ok) => ok && toast("ready-up started", "ok"))}>
            Ready-up
          </button>
          <button className="ghost" onClick={() => void post("gamestate", { state: "none" }).then((ok) => ok && toast("challenge cancelled", "ok"))}>
            Cancel challenge
          </button>
        </div>
      </section>
    </div>
  );
}

function BansTab({ id, post }: { id: string; post: (path: string, body?: unknown) => Promise<boolean> }) {
  const bans = usePolling<{ bans: PanelBan[]; windowMinutes: number }>(`/api/s/${id}/bans`, 6000);
  const [scope, setScope] = useState("endpoint");
  const [target, setTarget] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const list = bans.data?.bans ?? [];

  return (
    <div className="stack">
      <section className="card">
        <h2>Add a ban</h2>
        <div className="sub">
          endpoint bans roll off {bans.data?.windowMinutes ?? 60} minutes after the last offence · steam/ip bans last until removed
        </div>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!target.trim()) return;
            const ok = await post("bans", { scope, target: target.trim(), minutes, reason: reason.trim() || undefined });
            if (ok) {
              setTarget("");
              setReason("");
              toast("ban added", "ok");
              void bans.reload();
            }
          }}
        >
          <label>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="endpoint">endpoint ip:port (rolling)</option>
              <option value="steam">steam (permanent)</option>
              <option value="ip">ip (permanent)</option>
            </select>
          </label>
          <label>
            Target
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="7656… / 1.2.3.4:38000 / 1.2.3.4" />
          </label>
          <label>
            Minutes (0 = permanent)
            <input type="number" min={0} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
          </label>
          <label>
            Reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="optional" />
          </label>
          <div className="row end">
            <button type="submit" className="danger">
              Ban
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Active bans</h2>
        <div className="sub">{bans.error ?? `${list.length} entries`}</div>
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              <th>Target</th>
              <th>State</th>
              <th>Expires</th>
              <th>Strikes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td className="empty" colSpan={6}>
                  no bans
                </td>
              </tr>
            ) : (
              list.map((ban) => (
                <tr key={`${ban.scope}:${ban.target}`}>
                  <td>{ban.scope}</td>
                  <td className="mono">
                    <span className="trunc" title={ban.target}>
                      {ban.target}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${ban.state === "banned" ? "banned" : ""}`}>{ban.state}</span>
                  </td>
                  <td className="muted">{ban.expires === "permanent" ? "never" : ban.expires ? relative(ban.expires) : "—"}</td>
                  <td>{ban.strikesInWindow ?? "—"}</td>
                  <td className="actions">
                    <button
                      className="mini ghost"
                      onClick={async () => {
                        try {
                          await panelFetch(`/api/s/${id}/bans`, { method: "DELETE", body: { scope: ban.scope, target: ban.target } });
                          toast("unbanned", "ok");
                          void bans.reload();
                        } catch (problem) {
                          toast(problem instanceof Error ? problem.message : String(problem), "err");
                        }
                      }}
                    >
                      Unban
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function ConsoleTab({
  post,
  status,
}: {
  post: (path: string, body?: unknown) => Promise<boolean>;
  status: PanelStatus | null;
}) {
  const [command, setCommand] = useState("");

  return (
    <div className="stack">
      <section className="card">
        <h2>Host console</h2>
        <div className="sub">
          runs the game&apos;s own host command as the current host
          {status && status.host.playerId !== 255 ? ` (host #${status.host.playerId})` : " (no host assigned yet — use Host on a player first)"}
        </div>
        <form
          className="row"
          onSubmit={async (event) => {
            event.preventDefault();
            const line = command.trim();
            if (!line) return;
            if (await post("command", { command: line })) {
              setCommand("");
              toast(`ran: ${line}`, "ok");
            }
          }}
        >
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="e.g. setpassword hunter2, addcondition min_power 50"
          />
          <button type="submit">Run as host</button>
        </form>
      </section>
    </div>
  );
}

/**
 * ModTheIsland's own settings (Discord webhook, rate limits, guards). Values are read from
 * the server's /config, one POST per changed field, and the mod reloads the guard right away.
 */
function ModTab({ id }: { id: string }) {
  const [sections, setSections] = useState<PanelSettingSection[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await panelFetch<{ sections: PanelSettingSection[] }>(`/api/admin/server/${id}/config`);
      setSections(data.sections);
      const next: Record<string, string> = {};
      for (const section of data.sections) {
        for (const entry of section.entries) {
          next[`${section.name}:${entry.key}`] = entry.value === null ? "" : String(entry.value);
        }
      }
      setDraft(next);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function changed(section: PanelSettingSection): string[] {
    return section.entries
      .filter((entry) => !entry.sensitive && draft[`${section.name}:${entry.key}`] !== String(entry.value ?? ""))
      .map((entry) => entry.key);
  }

  async function save(section: PanelSettingSection) {
    setBusy(true);
    try {
      for (const key of changed(section)) {
        const result = await panelFetch<{ applied: string[]; restartRequired: string[]; errors: string[] }>(
          `/api/admin/server/${id}/config`,
          { method: "POST", body: { section: section.name, key, value: draft[`${section.name}:${key}`] ?? "" } },
        );
        if (result.errors.length > 0) toast(result.errors.join("; "), "err");
        else toast(`${section.name} · ${key} applied${result.restartRequired.length > 0 ? " (restart required)" : ""}`, "ok");
      }
      await load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null) {
    return (
      <section className="card down">
        <h2>Mod settings</h2>
        <p className="muted">{error}</p>
      </section>
    );
  }

  const needle = filter.trim().toLowerCase();
  const visible = sections
    .map((section) => ({
      section,
      entries: section.entries.filter(
        (entry) =>
          needle.length === 0 ||
          entry.key.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle) ||
          section.name.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.entries.length > 0);

  return (
    <div className="stack">
      <section className="card">
        <div className="row">
          <input
            placeholder="filter settings (e.g. webhook, rate, autoban)…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="muted mono">{visible.reduce((sum, group) => sum + group.entries.length, 0)} settings</span>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          values live in ModTheIsland.cfg; saving one reloads the guard immediately unless the section says otherwise
        </div>
      </section>
      {visible.map(({ section, entries }) => {
        const dirty = changed(section);
        return (
          <details className="card" key={section.name} open={needle.length > 0 || dirty.length > 0 || section.restart}>
            <summary>
              <h2>
                {section.name}
                {section.restart ? <span className="badge"> restart required</span> : null}
                {dirty.length > 0 ? <span className="badge ok"> {dirty.length} changed</span> : null}
              </h2>
            </summary>
            <div className="form-grid">
              {entries.map((entry) => {
                const field = `${section.name}:${entry.key}`;
                const value = draft[field] ?? "";
                const set = (next: string) => setDraft({ ...draft, [field]: next });
                return (
                  <label key={field}>
                    <span className="mono">{entry.key}</span>
                    {entry.sensitive ? (
                      <span className="muted">set with ADMIN_TOKEN on the server</span>
                    ) : entry.type === "bool" ? (
                      <input
                        type="checkbox"
                        name={field}
                        checked={value === "true"}
                        disabled={busy || section.restart}
                        onChange={(event) => set(event.target.checked ? "true" : "false")}
                      />
                    ) : entry.type === "string" ? (
                      <input
                        name={field}
                        value={value}
                        disabled={busy || section.restart}
                        onChange={(event) => set(event.target.value)}
                      />
                    ) : (
                      <input
                        type="number"
                        name={field}
                        value={value}
                        disabled={busy || section.restart}
                        onChange={(event) => set(event.target.value)}
                      />
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {entry.description}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="row end" style={{ marginTop: 10 }}>
              <button disabled={busy || section.restart || dirty.length === 0} onClick={() => void save(section)}>
                Save {section.name}
              </button>
            </div>
          </details>
        );
      })}
      {sections.length === 0 ? (
        <section className="card">
          <h2>Mod settings</h2>
          <p className="muted">reading settings…</p>
        </section>
      ) : null}
      {sections.length > 0 && visible.length === 0 ? (
        <section className="card">
          <p className="muted">no setting matches “{filter}”</p>
        </section>
      ) : null}
    </div>
  );
}
