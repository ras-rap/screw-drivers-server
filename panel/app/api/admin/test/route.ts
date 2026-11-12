import { errorResponse, requireAdmin } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { callServer } from "@/lib/upstream";
import type { PanelStatus } from "@/lib/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const probeInput = z.object({
  url: z.string().regex(/^https?:\/\/[^\s/]+/i, "must be an http(s) base URL"),
  /** omitted when testing a saved server, whose stored token is then used */
  token: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
});

/**
 * "Test" button on the admin page: talks to a server's admin API with the token you are
 * about to save, so a wrong URL or token is caught before it lands in the registry.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const input = probeInput.parse(await request.json());
    const url = input.url.replace(/\/+$/, "");

    let token = input.token;
    if (token === undefined && input.id !== undefined) {
      token = (await listServers()).find((server) => server.id === input.id)?.token;
    }
    if (token === undefined) {
      return Response.json({ ok: false, error: "token is required to test an unsaved server" }, { status: 400 });
    }

    const result = await callServer({ id: input.id ?? "probe", name: "probe", url, token }, "/status", {
      timeoutMs: 5000,
    });
    if (result.error !== undefined) {
      return Response.json(
        { ok: false, error: `cannot reach ${url} - ${result.error}`, hint: result.hint, url },
        { status: 502 },
      );
    }
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.status === 401 ? "the server rejected the token (401)" : `HTTP ${result.status}` },
        { status: 400 },
      );
    }

    const status = JSON.parse(result.body) as PanelStatus;
    return Response.json({
      ok: true,
      server: {
        name: status.serverName,
        version: status.gameVersion,
        port: status.port,
        players: `${status.currentPlayers}/${status.maxPlayers}`,
        uptime: status.uptimeSeconds,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
