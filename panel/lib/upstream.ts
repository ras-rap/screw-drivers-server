import type { PanelServer } from "./config";

export type UpstreamResult = {
  /** upstream answered 2xx with JSON */
  ok: boolean;
  /** HTTP status of the upstream answer, or 502/504 when it could not be reached */
  status: number;
  /** raw upstream body (empty when unreachable) */
  body: string;
  /** transport failure, or an answer that is not the admin API at all */
  error?: string;
  /** what to do about it */
  hint?: string;
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

    // A Cloudflare/nginx error page, a login form or the panel itself all "answer", and
    // pasting that HTML into a toast is useless: say what it probably is instead.
    const head = body.trimStart().slice(0, 1);
    if (body.length > 0 && head !== "{" && head !== "[") {
      const looksLikeHtml = head === "<";
      return {
        ok: false,
        status: response.status,
        body,
        error: looksLikeHtml
          ? `the answer was an HTML page, not the admin API (HTTP ${response.status})`
          : `the answer was not JSON (HTTP ${response.status}): ${body.slice(0, 120)}`,
        hint: looksLikeHtml
          ? "use http://<server-ip>:<admin port> directly - a hostname behind Cloudflare/nginx cannot carry the admin API (wrong port, proxy error, or a login page)"
          : "check the port: it must be the mod's Admin Port (the log line 'admin api : bind 0.0.0.0:<port>')",
      };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      body: "",
      error: aborted
        ? `no answer within ${TIMEOUT_MS} ms`
        : `could not connect (${error instanceof Error ? error.message : String(error)})`,
      hint: aborted
        ? "the host is reachable but slow or filtering - check firewall rules for that port"
        : "nothing accepted the connection: wrong IP/port, the server is down, or a firewall blocks it",
    };
  } finally {
    clearTimeout(timer);
  }
}
