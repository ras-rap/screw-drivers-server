import { z } from "zod";

/**
 * Thin client for the Pterodactyl **application** API, used for the two things the
 * per-server admin API cannot do: start a server whose container is stopped, and
 * pre-fill the "add server" form from the panel's own server list.
 *
 * Needs an application key (ptla_…) with read + power permissions. Nothing here is
 * required: without the env vars the panel works exactly as before.
 */
export type PterodactylConfig = { url: string; key: string };

export type PterodactylAllocation = { ip: string; port: number; alias?: string };

export type PterodactylServer = {
  id: number;
  identifier: string;
  name: string;
  node?: string;
  status?: string;
  allocations: PterodactylAllocation[];
};

const allocation = z.object({
  ip: z.string(),
  port: z.number().int(),
  ip_alias: z.string().nullable().optional(),
});

const serverAttributes = z.object({
  id: z.number().int(),
  identifier: z.string(),
  name: z.string(),
  status: z.string().nullable().optional(),
  node: z.string().optional(),
  relationships: z
    .object({
      allocations: z.object({ data: z.array(z.object({ attributes: allocation })) }).optional(),
      node: z.object({ attributes: z.object({ name: z.string() }).optional() }).optional(),
    })
    .optional(),
});

const listResponse = z.object({ data: z.array(z.object({ attributes: serverAttributes })) });

const singleResponse = z.object({ attributes: serverAttributes });

export const powerSignal = z.enum(["start", "stop", "restart", "kill"]);
export type PowerSignal = z.infer<typeof powerSignal>;

export class PterodactylError extends Error {
  status: number;
  hint?: string;

  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

export function pterodactylConfig(): PterodactylConfig | null {
  const url = process.env.PTERODACTYL_URL?.trim().replace(/\/+$/, "");
  const key = process.env.PTERODACTYL_API_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

async function request<T>(config: PterodactylConfig, path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "check that this is an Application API key (ptla_…), not a client key (ptlc_…), and that it has Servers: read + Servers: power"
        : response.status === 404
          ? "check PTERODACTYL_URL - it must be the panel base URL, without /api on the end"
          : undefined;
    throw new PterodactylError(
      response.status,
      `Pterodactyl answered HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
      hint,
    );
  }
  if (text.length === 0) return schema.parse({});
  return schema.parse(JSON.parse(text));
}

function toServer(attributes: z.infer<typeof serverAttributes>): PterodactylServer {
  const allocations = (attributes.relationships?.allocations?.data ?? []).map((entry) => ({
    ip: entry.attributes.ip_alias || entry.attributes.ip,
    port: entry.attributes.port,
    alias: entry.attributes.ip_alias ?? undefined,
  }));
  return {
    id: attributes.id,
    identifier: attributes.identifier,
    name: attributes.name,
    node: attributes.relationships?.node?.attributes?.name ?? attributes.node,
    status: attributes.status ?? undefined,
    allocations,
  };
}

/** Everything the application key can see; one page of 100 is plenty for a game panel. */
export async function listPterodactylServers(config: PterodactylConfig): Promise<PterodactylServer[]> {
  const page = await request(config, "/api/application/servers?include=allocations,node&per_page=100", { method: "GET" }, listResponse);
  return page.data.map((entry) => toServer(entry.attributes));
}

export async function getPterodactylServer(config: PterodactylConfig, id: number): Promise<PterodactylServer> {
  const one = await request(
    config,
    `/api/application/servers/${id}?include=allocations,node`,
    { method: "GET" },
    singleResponse,
  );
  return toServer(one.attributes);
}

/** start / stop / restart / kill on the node. "stop" asks for a graceful shutdown. */
export async function setPower(config: PterodactylConfig, id: number, signal: PowerSignal): Promise<void> {
  await request(config, `/api/application/servers/${id}/power`, {
    method: "POST",
    body: JSON.stringify({ signal }),
  }, z.unknown());
}
