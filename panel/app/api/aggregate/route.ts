import { errorResponse, requireViewer, visibleServers } from "@/lib/auth";
import type { PanelPlayer, PanelStatus, ServerSummary } from "@/lib/client";
import { callServer } from "@/lib/upstream";

export const dynamic = "force-dynamic";

/**
 * One request the browser makes to see every server: status + players are fetched in
 * parallel server-side, so tokens stay here and the browser gets a single payload.
 */
export async function GET() {
  try {
    const viewer = await requireViewer();

    const visible = await visibleServers(viewer);

    const summaries: ServerSummary[] = await Promise.all(
      visible.map(async (server) => {
        const [statusResult, playersResult] = await Promise.all([
          callServer(server, "/status"),
          callServer(server, "/players"),
        ]);

        if (!statusResult.ok) {
          return {
            id: server.id,
            name: server.name,
            group: server.group,
            ok: false,
            error: statusResult.error ?? `HTTP ${statusResult.status}`,
            pterodactyl: server.pterodactyl ?? null,
          };
        }

        let status: PanelStatus | undefined;
        let players: PanelPlayer[] | undefined;
        try {
          status = JSON.parse(statusResult.body) as PanelStatus;
          if (playersResult.ok) {
            const parsedPlayers = JSON.parse(playersResult.body) as { players?: PanelPlayer[] };
            players = parsedPlayers.players ?? [];
          }
        } catch (error) {
          return {
            id: server.id,
            name: server.name,
            group: server.group,
            ok: false,
            error: `unreadable answer: ${error instanceof Error ? error.message : error}`,
            pterodactyl: server.pterodactyl ?? null,
          };
        }

        return {
          id: server.id,
          name: server.name,
          group: server.group,
          ok: true,
          status,
          players,
          pterodactyl: server.pterodactyl ?? null,
        };
      }),
    );

    return Response.json({ ok: true, servers: summaries });
  } catch (error) {
    return errorResponse(error);
  }
}
