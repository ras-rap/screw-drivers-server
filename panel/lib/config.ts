import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** One dedicated server as the panel knows it. */
export type PanelServer = {
  /** stable id used in URLs, e.g. "eu-1" */
  id: string;
  name: string;
  /** base URL of that server's admin API, e.g. http://10.0.0.5:38080 */
  url: string;
  /** bearer token of the server's ModTheIsland admin API - never sent to the browser */
  token: string;
  group?: string;
  /** per-server allowlist of Clerk emails / user ids; empty = panel list decides */
  allowed?: string[];
};

const serverEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  url: z.string().regex(/^https?:\/\/[^\s/]+/i, "must be an http(s) base URL"),
  token: z.string().min(1, "the admin bearer token is required"),
  group: z.string().min(1).optional(),
  allowed: z.array(z.string().min(1)).optional(),
});

/** `[{...}]` and `{"servers": [{...}]}` are both accepted. */
const registry = z.union([z.array(serverEntry), z.object({ servers: z.array(serverEntry) })]);

const clerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

/**
 * "clerk" - real OAuth (Clerk, Discord as the social connection) plus the allowlists.
 * "dev"   - fake signed-in user, for local work without OAuth.
 * "off"   - production without Clerk keys: nobody gets in (misconfiguration).
 */
export const authMode: "clerk" | "dev" | "off" =
  process.env.PANEL_DEV_AUTH === "1" || (!clerkConfigured && process.env.NODE_ENV !== "production")
    ? "dev"
    : clerkConfigured
      ? "clerk"
      : "off";

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Panel-wide allowlists from the environment; the admin page can extend them in the store. */
export const envAllowedEmails = splitList(process.env.PANEL_ALLOWED_EMAILS);
export const envAllowedUserIds = splitList(process.env.PANEL_ALLOWED_USER_IDS);

/** Admins may manage servers and access from the panel. They only come from the environment. */
export const envAdminEmails = splitList(process.env.PANEL_ADMIN_EMAILS);
export const envAdminUserIds = splitList(process.env.PANEL_ADMIN_USER_IDS);

/** Servers declared in the environment (read-only in the panel). */
let envCache: { key: string; servers: PanelServer[] } | null = null;

export function envServers(): PanelServer[] {
  const inline = process.env.PANEL_SERVERS?.trim();
  const file = process.env.PANEL_SERVERS_FILE || "servers.json";
  const key = inline ? `inline:${inline}` : `file:${file}`;
  if (envCache && envCache.key === key) return envCache.servers;

  let raw: string | null = null;
  try {
    raw = inline ?? fs.readFileSync(path.isAbsolute(file) ? file : path.join(process.cwd(), file), "utf8");
  } catch {
    // No env registry at all is the normal case: servers live in the panel's own store.
    envCache = { key, servers: [] };
    return envCache.servers;
  }

  try {
    const parsed = registry.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.servers;
    envCache = {
      key,
      servers: entries.map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        url: entry.url.replace(/\/+$/, ""),
        token: entry.token,
        group: entry.group,
        allowed: entry.allowed,
      })),
    };
  } catch (error) {
    console.error(`[panel] ${inline ? "PANEL_SERVERS" : file}: ${error instanceof Error ? error.message : error}`);
    envCache = { key, servers: [] };
  }
  return envCache.servers;
}

/** Where the panel keeps servers added through the UI. */
export const dataFile = process.env.PANEL_DATA_FILE || path.join(process.cwd(), "data", "panel.json");
