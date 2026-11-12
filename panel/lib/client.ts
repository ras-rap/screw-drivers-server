export type ServerSummary = {
  id: string;
  name: string;
  group?: string;
  ok: boolean;
  error?: string;
  status?: PanelStatus;
  players?: PanelPlayer[];
  /** set when the panel entry is linked to a Pterodactyl server (power control) */
  pterodactyl?: { serverId: number; identifier: string } | null;
};

export type PanelPlayer = {
  playerId: number;
  name: string;
  steamId: string | null;
  endpoint: string;
  ping: number;
  idleSeconds: number;
  isHost: boolean;
  isAdmin: boolean;
  banned: boolean;
};

export type PanelStatus = {
  gameVersion: string;
  serverName: string;
  scene: string;
  uptimeSeconds: number;
  port: number;
  maxPlayers: number;
  currentPlayers: number;
  hasPassword: boolean;
  nobleConnect: boolean;
  host: { playerId: number; steamId: string | null };
  hostSettings: {
    damagePercentage: number;
    maxAcceleration: number;
    downforceAllowed: boolean;
    repairingAllowed: boolean;
    mapVoteAtEnd: boolean;
    playMode: number;
    amountOfRounds: number;
  } | null;
  bans: { steam: number; ip: number; endpoint: number; endpointWindowMinutes: number };
  chatLastSeq: number;
};

export type PanelChatLine = {
  seq: number;
  time: string;
  kind: string;
  playerId: number;
  name: string | null;
  steamId: string | null;
  message: string;
};

export type PanelSetting = {
  key: string;
  type: "bool" | "int" | "long" | "float" | "double" | "string";
  value: string | number | boolean | null;
  sensitive: boolean;
  description: string;
};

export type PanelSettingSection = {
  name: string;
  restart: boolean;
  entries: PanelSetting[];
};

export type PanelIsland = { uniqueId: number; sortOrder: number; name?: string };

export type PanelBan = {
  scope: string;
  target: string;
  state: string;
  reason?: string;
  expires?: string;
  strikesInWindow?: string;
};

/** Fetch JSON from the panel's own BFF and turn API errors into thrown Errors. */
export async function panelFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
