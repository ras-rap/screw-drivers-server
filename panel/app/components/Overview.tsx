"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { panelFetch } from "@/lib/client";
import { toast } from "./Toaster";
import type { ServerSummary } from "@/lib/client";
import { usePolling } from "./usePolling";

type Props = {
  viewer: { label: string; email: string | null; dev: boolean; admin: boolean };
  authMode: "clerk" | "dev" | "off";
};

function uptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function Overview({ viewer, authMode }: Props) {
  const { data, error } = usePolling<{ servers: ServerSummary[] }>("/api/aggregate", 4000);

  const servers = data?.servers ?? [];
  const totalPlayers = servers.reduce((sum, item) => sum + (item.status?.currentPlayers ?? 0), 0);
  const online = servers.filter((item) => item.ok).length;

  return (
    <>
      <div className="topbar">
        <h1>Screw Drivers — server panel</h1>
        <span className="muted mono">
          {online}/{servers.length} online · {totalPlayers} players
        </span>
        <span className="spacer" />
        {viewer.admin ? (
          <Link className="badge" href="/admin">
            admin
          </Link>
        ) : null}
        <span className="who">
          {viewer.label}
          {viewer.dev ? <span className="badge" style={{ marginLeft: 6 }}>dev auth</span> : null}
        </span>
        {authMode === "clerk" ? <UserButton /> : null}
      </div>

      <main className="page">
        {error ? (
          <p className="card down" style={{ marginBottom: 14 }}>
            panel: {error}
          </p>
        ) : null}

        {servers.length === 0 ? (
          <div className="card notice">
            <h2>No servers configured</h2>
            <p className="muted">
              Add them to <code>servers.json</code> (or the <code>PANEL_SERVERS</code> environment variable) and
              reload. Each entry needs the admin URL and bearer token of that server.
            </p>
          </div>
        ) : (
          <div className="grid">
            {servers.map((server) => {
              const status = server.status;
              return (
                <article key={server.id} className={`card ${server.ok ? "" : "down"}`}>
                  <div className="row">
                    <span className={`dot ${server.ok ? "ok" : "bad"}`} />
                    <h2>{server.name}</h2>
                    {server.group ? <span className="badge">{server.group}</span> : null}
                    <span className="spacer" />
                    <Link className="badge" href={`/server/${server.id}`}>
                      open →
                    </Link>
                  </div>

                  {server.ok && status ? (
                    <>
                      <div className="sub">
                        {status.currentPlayers}/{status.maxPlayers} players · {status.port}/udp ·{" "}
                        {uptime(status.uptimeSeconds)} up
                      </div>
                      <div className="row" style={{ fontSize: 12 }}>
                        <span className="muted">host</span>
                        {status.host.playerId === 255 ? (
                          <span className="badge">none</span>
                        ) : (
                          <span className="badge host">#{status.host.playerId}</span>
                        )}
                        {status.serverName && status.serverName !== server.name ? (
                          <span className="muted trunc" title={status.serverName}>
                            as “{status.serverName}”
                          </span>
                        ) : null}
                      </div>
                      <div className="row" style={{ marginTop: 8, fontSize: 12 }}>
                        <span className="badge">{status.gameVersion}</span>
                        {status.hasPassword ? <span className="badge">password</span> : null}
                        {status.bans.endpoint > 0 ? (
                          <span className="badge banned">{status.bans.endpoint} endpoint bans</span>
                        ) : null}
                        {status.bans.steam > 0 ? <span className="badge">{status.bans.steam} steam bans</span> : null}
                      </div>
                      {server.players && server.players.length > 0 ? (
                        <div className="row" style={{ marginTop: 8, fontSize: 12 }}>
                          {server.players.slice(0, 6).map((player) => (
                            <span key={player.playerId} className="badge">
                              {player.name}
                              {player.isHost ? " 👑" : ""}
                            </span>
                          ))}
                          {server.players.length > 6 ? (
                            <span className="badge">+{server.players.length - 6}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="sub">offline — {server.error ?? "no answer"}</div>
                      <div className="row" style={{ marginTop: 8 }}>
                        {server.pterodactyl && viewer.admin ? (
                          <button
                            className="mini"
                            onClick={async () => {
                              try {
                                await panelFetch(`/api/admin/pterodactyl/${server.pterodactyl?.serverId}/power`, {
                                  method: "POST",
                                  body: { signal: "start" },
                                });
                                toast(`start signal sent to ${server.name}`, "ok");
                              } catch (problem) {
                                toast(problem instanceof Error ? problem.message : String(problem), "err");
                              }
                            }}
                          >
                            Start (Pterodactyl)
                          </button>
                        ) : null}
                        <Link className="badge" href={`/server/${server.id}`}>
                          open →
                        </Link>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
