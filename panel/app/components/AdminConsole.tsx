"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { panelFetch } from "@/lib/client";
import { toast } from "./Toaster";

type AdminServer = {
  id: string;
  name: string;
  url: string;
  group?: string;
  allowed?: string[];
  source: "panel" | "env";
  locked: boolean;
  hasToken: boolean;
  pterodactyl?: { serverId: number; identifier: string };
  createdAt?: string;
  updatedAt?: string;
};

type AccessState = {
  stored: { emails: string[]; userIds: string[] };
  env: { allowedEmails: string[]; allowedUserIds: string[]; adminEmails: string[]; adminUserIds: string[] };
};

type PterodactylServer = {
  id: number;
  identifier: string;
  name: string;
  node?: string;
  status?: string;
  allocations: { ip: string; port: number }[];
  linkedPanelId: string | null;
};

type Draft = {
  id: string;
  name: string;
  url: string;
  group: string;
  token: string;
  allowed: string;
  pterodactyl: { serverId: number; identifier: string } | null;
};

const emptyDraft: Draft = {
  id: "",
  name: "",
  url: "http://",
  group: "",
  token: "",
  allowed: "",
  pterodactyl: null,
};

export function AdminConsole({ viewerLabel }: { viewerLabel: string }) {
  const [servers, setServers] = useState<AdminServer[]>([]);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  const [pterodactyl, setPterodactyl] = useState<{ configured: boolean; servers: PterodactylServer[] }>({
    configured: false,
    servers: [],
  });
  const [allocation, setAllocation] = useState<Record<number, string>>({});
  const [emails, setEmails] = useState("");
  const [userIds, setUserIds] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadServers() {
    try {
      const data = await panelFetch<{ servers: AdminServer[] }>("/api/admin/servers");
      setServers(data.servers);
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    }
  }

  async function loadAccess() {
    try {
      const data = await panelFetch<AccessState>("/api/admin/access");
      setAccess(data);
      setEmails(data.stored.emails.join("\n"));
      setUserIds(data.stored.userIds.join("\n"));
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    }
  }

  async function loadPterodactyl() {
    try {
      const data = await panelFetch<{ configured: boolean; servers: PterodactylServer[] }>("/api/admin/pterodactyl");
      setPterodactyl(data);
      setAllocation((current) => {
        const next = { ...current };
        for (const server of data.servers) {
          if (next[server.id] === undefined && server.allocations.length > 0) {
            next[server.id] = `${server.allocations[0].ip}:${server.allocations[0].port}`;
          }
        }
        return next;
      });
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    }
  }

  useEffect(() => {
    void loadServers();
    void loadAccess();
    void loadPterodactyl();
  }, []);

  function startEdit(server: AdminServer) {
    setEditing(server.id);
    setDraft({
      id: server.id,
      name: server.name,
      url: server.url,
      group: server.group ?? "",
      token: "",
      allowed: (server.allowed ?? []).join(", "),
      pterodactyl: server.pterodactyl ?? null,
    });
    setProbe(null);
  }

  function resetForm() {
    setEditing(null);
    setDraft(emptyDraft);
    setProbe(null);
  }

  async function testConnection() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { url: draft.url.trim() };
      if (draft.token.length > 0) body.token = draft.token;
      else if (editing !== null) body.id = editing;
      const data = await panelFetch<{ server: { name: string; version: string; port: number; players: string } }>(
        "/api/admin/test",
        { method: "POST", body },
      );
      setProbe(`ok · ${data.server.name} · ${data.server.version} · ${data.server.players} players · udp ${data.server.port}`);
      toast("connection ok", "ok");
    } catch (problem) {
      setProbe(null);
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        url: draft.url.trim(),
        allowed: draft.allowed
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      };
      if (draft.group.trim().length > 0) body.group = draft.group.trim();
      if (draft.token.length > 0) body.token = draft.token;
      body.pterodactyl = draft.pterodactyl;

      if (editing === null) {
        if (draft.id.trim().length > 0) body.id = draft.id.trim();
        await panelFetch("/api/admin/servers", { method: "POST", body });
        toast("server added", "ok");
      } else {
        await panelFetch(`/api/admin/servers/${editing}`, { method: "PUT", body });
        toast("server updated", "ok");
      }
      await loadServers();
      resetForm();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(server: AdminServer) {
    if (!confirm(`Remove ${server.name} from the panel? The server itself keeps running.`)) return;
    try {
      await panelFetch(`/api/admin/servers/${server.id}`, { method: "DELETE" });
      toast("server removed", "ok");
      await loadServers();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    }
  }

  async function saveAccess() {
    setBusy(true);
    try {
      await panelFetch("/api/admin/access", {
        method: "PUT",
        body: {
          emails: emails.split("\n").map((entry) => entry.trim()).filter(Boolean),
          userIds: userIds.split("\n").map((entry) => entry.trim()).filter(Boolean),
        },
      });
      toast("access list saved", "ok");
      await loadAccess();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : String(problem), "err");
    } finally {
      setBusy(false);
    }
  }

  async function testSaved(server: AdminServer) {
    setBusy(true);
    try {
      const data = await panelFetch<{ server: { name: string; version: string; players: string } }>("/api/admin/test", {
        method: "POST",
        body: { url: server.url, id: server.id },
      });
      toast(`${server.name}: ok · ${data.server.name} · ${data.server.version} · ${data.server.players} players`, "ok");
    } catch (problem) {
      toast(`${server.name}: ${problem instanceof Error ? problem.message : String(problem)}`, "err");
    } finally {
      setBusy(false);
    }
  }

  const editingServer = editing === null ? null : servers.find((server) => server.id === editing) ?? null;

  return (
    <>
      <div className="topbar">
        <Link className="badge" href="/">
          ← panel
        </Link>
        <h1>Panel admin</h1>
        <span className="spacer" />
        <span className="who">{viewerLabel}</span>
      </div>

      <main className="page stack">
        <section className="card">
          <h2>Servers</h2>
          <div className="sub">
            servers added here are stored in the panel (<code>data/panel.json</code>); ones from{" "}
            <code>PANEL_SERVERS</code>/<code>servers.json</code> are read-only
          </div>
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>name</th>
                <th>admin url</th>
                <th>group</th>
                <th>source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {servers.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={6}>
                    no servers yet — add one below
                  </td>
                </tr>
              ) : (
                servers.map((server) => (
                  <tr key={server.id}>
                    <td className="mono">{server.id}</td>
                    <td>
                      {server.name}
                      {(server.allowed?.length ?? 0) > 0 ? <span className="badge">restricted</span> : null}
                      {server.pterodactyl ? (
                        <span className="badge ok">pterodactyl #{server.pterodactyl.serverId}</span>
                      ) : null}
                    </td>
                    <td className="mono muted">
                      <span className="trunc" title={server.url}>
                        {server.url}
                      </span>
                    </td>
                    <td className="muted">{server.group ?? "—"}</td>
                    <td>
                      <span className={`badge ${server.locked ? "" : "ok"}`}>{server.source}</span>
                    </td>
                    <td className="actions">
                      <button className="mini ghost" onClick={() => void testSaved(server)} disabled={busy}>
                        Test
                      </button>{" "}
                      <button className="mini ghost" onClick={() => startEdit(server)} disabled={server.locked}>
                        Edit
                      </button>{" "}
                      <button className="mini danger" onClick={() => void remove(server)} disabled={server.locked}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {pterodactyl.configured ? (
          <section className="card">
            <h2>Import from Pterodactyl</h2>
            <div className="sub">
              pick the allocation the server&apos;s admin API listens on, then paste that server&apos;s token (its
              <code> Admin Token </code> egg variable) into the form below
            </div>
            <table>
              <thead>
                <tr>
                  <th>name</th>
                  <th>node</th>
                  <th>state</th>
                  <th>admin allocation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pterodactyl.servers.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={5}>
                      the application key does not see any servers
                    </td>
                  </tr>
                ) : (
                  pterodactyl.servers.map((server) => (
                    <tr key={server.id}>
                      <td>
                        {server.name} <span className="muted mono">#{server.id}</span>
                      </td>
                      <td className="muted">{server.node ?? "—"}</td>
                      <td className="muted">{server.status ?? "—"}</td>
                      <td>
                        <select
                          value={allocation[server.id] ?? ""}
                          onChange={(event) => setAllocation({ ...allocation, [server.id]: event.target.value })}
                          disabled={server.allocations.length === 0}
                        >
                          {server.allocations.map((entry) => (
                            <option key={`${entry.ip}:${entry.port}`} value={`${entry.ip}:${entry.port}`}>
                              {entry.ip}:{entry.port}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="actions">
                        {server.linkedPanelId !== null ? (
                          <span className="badge ok">in panel</span>
                        ) : (
                          <button
                            className="mini ghost"
                            onClick={() => {
                              const chosen = allocation[server.id];
                              if (!chosen) {
                                toast("no allocation to import", "err");
                                return;
                              }
                              setEditing(null);
                              setProbe(null);
                              setDraft({
                                id: "",
                                name: server.name,
                                url: `http://${chosen}`,
                                group: server.node ?? "",
                                token: "",
                                allowed: "",
                                pterodactyl: { serverId: server.id, identifier: server.identifier },
                              });
                              toast("filled the form below — paste the token and press Add server", "ok");
                            }}
                          >
                            Import
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="card">
          <h2>{editing === null ? "Add a server" : `Edit ${editingServer?.name ?? editing}`}</h2>
          <div className="sub">
            the token is printed by the server on boot (or set <code>ADMIN_TOKEN</code> in its environment)
          </div>
          <div className="form-grid">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="EU #1"
              />
            </label>
            <label>
              Id {editing === null ? "(optional)" : "(fixed)"}
              <input
                value={draft.id}
                onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                placeholder="derived from the name"
                disabled={editing !== null}
              />
            </label>
            <label>
              Admin URL
              <input
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                placeholder="http://10.0.0.11:38080"
              />
            </label>
            <label>
              Group (optional)
              <input
                value={draft.group}
                onChange={(event) => setDraft({ ...draft, group: event.target.value })}
                placeholder="EU"
              />
            </label>
            <label>
              Token {editing === null ? "" : "(blank = keep current)"}
              <input
                value={draft.token}
                onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                placeholder={editing === null ? "bearer token" : "unchanged"}
                autoComplete="off"
              />
            </label>
            <label>
              Allowed users (comma separated, optional)
              <input
                value={draft.allowed}
                onChange={(event) => setDraft({ ...draft, allowed: event.target.value })}
                placeholder="you@example.com, user_2abc…"
              />
            </label>
          </div>
          {draft.pterodactyl !== null ? (
            <p className="muted">
              linked to Pterodactyl server #{draft.pterodactyl.serverId} ({draft.pterodactyl.identifier}) — the overview
              gets a Start button while it is down.{" "}
              <button className="mini ghost" onClick={() => setDraft({ ...draft, pterodactyl: null })}>
                unlink
              </button>
            </p>
          ) : null}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => void testConnection()} disabled={busy || draft.url.length < 8}>
              Test connection
            </button>
            <button onClick={() => void save()} disabled={busy || draft.name.trim().length === 0 || draft.url.length < 8}>
              {editing === null ? "Add server" : "Save changes"}
            </button>
            {editing !== null ? (
              <button className="ghost" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
            {probe !== null ? <span className="muted mono">{probe}</span> : null}
          </div>
        </section>

        <section className="card">
          <h2>Who can use the panel</h2>
          <div className="sub">
            one entry per line · an entry can be a Clerk email or a user id · leave both empty to allow any signed-in
            account
          </div>
          <div className="form-grid">
            <label>
              Emails
              <textarea
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                rows={4}
                className="textarea"
              />
            </label>
            <label>
              Clerk user ids
              <textarea
                value={userIds}
                onChange={(event) => setUserIds(event.target.value)}
                rows={4}
                className="textarea"
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => void saveAccess()} disabled={busy}>
              Save access list
            </button>
            {access !== null &&
            (access.env.allowedEmails.length > 0 ||
              access.env.allowedUserIds.length > 0 ||
              access.env.adminEmails.length > 0 ||
              access.env.adminUserIds.length > 0) ? (
              <span className="muted mono">
                env pins: allowed {[...access.env.allowedEmails, ...access.env.allowedUserIds].join(", ") || "—"} ·
                admins {[...access.env.adminEmails, ...access.env.adminUserIds].join(", ") || "—"}
              </span>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Admins are environment-only on purpose (<code>PANEL_ADMIN_EMAILS</code> /{" "}
            <code>PANEL_ADMIN_USER_IDS</code>), so a hijacked panel session cannot promote itself.
          </p>
        </section>
      </main>
    </>
  );
}
