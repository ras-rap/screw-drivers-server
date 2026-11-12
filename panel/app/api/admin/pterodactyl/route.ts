import { errorResponse, requireAdmin } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { listPterodactylServers, pterodactylConfig } from "@/lib/pterodactyl";

export const dynamic = "force-dynamic";

/**
 * Pterodactyl servers the application key can see, so they can be imported with one
 * click. Tokens are never here: the admin API token still comes from the server's own
 * `Admin Token` egg variable.
 */
export async function GET() {
  try {
    await requireAdmin();
    const config = pterodactylConfig();
    if (config === null) return Response.json({ ok: true, configured: false, servers: [] });

    const [remote, linked] = await Promise.all([listPterodactylServers(config), listServers()]);
    const byIdentifier = new Map<string, string>();
    for (const server of linked) {
      if (server.pterodactyl) byIdentifier.set(server.pterodactyl.identifier, server.id);
    }

    return Response.json({
      ok: true,
      configured: true,
      servers: remote.map((server) => ({
        ...server,
        linkedPanelId: byIdentifier.get(server.identifier) ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
