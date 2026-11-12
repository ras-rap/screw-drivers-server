import type { PanelServer } from "./config";

export type UpstreamResult = {
  /** upstream answered 2xx */
  ok: boolean;
  /** HTTP status of the upstream answer, or 502/504 when it could not be reached */
  status: number;
  /** raw upstream body (empty when unreachable) */
  body: string;
  /** transport failure only: unreachable, timed out */
  error?: string;
};

const TIMEOUT_MS = 6000;

/**
 * Calls one server's ModTheIsland admin API with its bearer token. Never throws: a dead
 * or slow server becomes `{ok:false}` so the panel can render it as offline.
 */
export async function callServer(
  server: PanelServer,
  path: string,
  init?: { method?: string; body?: string; timeoutMs?: number },
): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? TIMEOUT_MS);
  try {
    const response = await fetch(`${server.url}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${server.token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      body: "",
      error: aborted ? `no answer within ${TIMEOUT_MS} ms` : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
