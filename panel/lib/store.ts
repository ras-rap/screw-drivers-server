import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataFile, envServers, type PanelServer } from "./config";

/** A server as the panel exposes it: everything in PanelServer plus provenance. */
export type ManagedServer = PanelServer & {
  source: "panel" | "env";
  pterodactyl?: { serverId: number; identifier: string };
  createdAt?: string;
  updatedAt?: string;
};

const idRule = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

/** Optional link to the Pterodactyl server behind this entry (for power control). */
const pterodactylLink = z.object({
  serverId: z.number().int().positive(),
  identifier: z.string().min(1),
});

const storedServer = z.object({
  id: idRule,
  name: z.string().min(1).max(80),
  url: z.string().regex(/^https?:\/\/[^\s/]+/i, "must be an http(s) base URL"),
  token: z.string().min(1),
  group: z.string().min(1).max(24).optional(),
  allowed: z.array(z.string().min(1)).max(200).optional(),
  pterodactyl: pterodactylLink.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What the admin UI may submit; the token is only replaced when present. */
export const serverInput = z.object({
  id: idRule.optional(),
  name: z.string().min(1).max(80),
  url: z.string().regex(/^https?:\/\/[^\s/]+/i, "must be an http(s) base URL"),
  token: z.string().min(1).optional(),
  group: z.string().min(1).max(24).optional(),
  allowed: z.array(z.string().min(1)).max(200).optional(),
  /** null clears an existing link */
  pterodactyl: pterodactylLink.nullable().optional(),
});

export type ServerInput = z.infer<typeof serverInput>;

const storeSchema = z.object({
  version: z.literal(1),
  servers: z.array(storedServer),
  access: z.object({
    emails: z.array(z.string().min(1)),
    userIds: z.array(z.string().min(1)),
  }),
});

type Store = z.infer<typeof storeSchema>;
export type StoredServer = z.infer<typeof storedServer>;

const empty: Store = { version: 1, servers: [], access: { emails: [], userIds: [] } };

// One writer at a time; the file is tiny and edits are rare.
let queue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<Store> {
  let raw: string;
  try {
    raw = await fs.readFile(dataFile, "utf8");
  } catch {
    return { ...empty, servers: [], access: { emails: [], userIds: [] } };
  }

  const parsed = storeSchema.safeParse(JSON.parse(raw));
  if (parsed.success) return parsed.data;

  const backup = `${dataFile}.invalid-${Date.now()}`;
  await fs.writeFile(backup, raw, "utf8").catch(() => undefined);
  console.error(
    `[panel] ${dataFile} is not valid (${parsed.error.issues.map((issue) => issue.message).join("; ")}); ` +
      `kept a copy at ${backup} and started from an empty store`,
  );
  return { ...empty, servers: [], access: { emails: [], userIds: [] } };
}

async function writeStore(next: Store): Promise<void> {
  storeSchema.parse(next);
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, dataFile);
}

/** Read-modify-write with the store's mutex; the callback may mutate and return a result. */
function mutate<T>(change: (store: Store) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await change(store);
    await writeStore(store);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Servers from the store plus the ones the environment declares (env first, locked). */
export async function listServers(): Promise<ManagedServer[]> {
  const store = await readStore();
  const env = envServers();
  const envIds = new Set(env.map((server) => server.id));
  return [
    ...env.map((server) => ({ ...server, source: "env" as const })),
    ...store.servers
      .filter((server) => !envIds.has(server.id))
      .map((server) => ({
        id: server.id,
        name: server.name,
        url: server.url,
        token: server.token,
        group: server.group,
        allowed: server.allowed,
        pterodactyl: server.pterodactyl,
        source: "panel" as const,
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
      })),
  ];
}

export function createServer(input: ServerInput): Promise<StoredServer> {
  return mutate((store) => {
    const id = input.id ?? slug(input.name);
    if (envServers().some((server) => server.id === id) || store.servers.some((server) => server.id === id)) {
      throw new StoreError(409, `a server with id "${id}" already exists`);
    }
    if (!input.token) throw new StoreError(400, "token is required for a new server");
    const now = new Date().toISOString();
    const server: StoredServer = {
      id,
      name: input.name,
      url: input.url.replace(/\/+$/, ""),
      token: input.token,
      group: input.group,
      allowed: input.allowed !== undefined && input.allowed.length > 0 ? input.allowed : undefined,
      pterodactyl: input.pterodactyl ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    store.servers.push(server);
    return server;
  });
}

export function updateServer(id: string, input: ServerInput): Promise<StoredServer> {
  return mutate((store) => {
    const server = store.servers.find((candidate) => candidate.id === id);
    if (!server) throw new StoreError(404, "unknown server");
    server.name = input.name;
    server.url = input.url.replace(/\/+$/, "");
    if (input.token !== undefined) server.token = input.token;
    server.group = input.group;
    server.allowed = input.allowed !== undefined && input.allowed.length > 0 ? input.allowed : undefined;
    server.pterodactyl = input.pterodactyl ?? undefined;
    server.updatedAt = new Date().toISOString();
    return server;
  });
}

export function deleteServer(id: string): Promise<void> {
  return mutate((store) => {
    const index = store.servers.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new StoreError(404, "unknown server");
    store.servers.splice(index, 1);
  });
}

export async function readAccess(): Promise<Store["access"]> {
  const store = await readStore();
  return store.access;
}

export function writeAccess(access: Store["access"]): Promise<Store["access"]> {
  return mutate((store) => {
    store.access = { emails: dedupe(access.emails), userIds: dedupe(access.userIds) };
    return store.access;
  });
}

export class StoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base.length > 0 ? base : `server-${Date.now().toString(36)}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
