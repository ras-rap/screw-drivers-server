import { errorResponse, requireAdmin } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { listPterodactylServers, pterodactylConfig, PterodactylError } from "@/lib/pterodactyl";

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

    const url = config.url;
    const keyLooksValid = config.key.startsWith("ptla_");
    const keyHint = keyLooksValid
      ? undefined
      : "PTERODACTYL_API_KEY does not start with ptla_ - that is an Application API key; a client key (ptlc_…) cannot list servers";

    let remote: Awaited<ReturnType<typeof listPterodactylServers>>;
    try {
      remote = await listPterodactylServers(config);
    } catch (problem) {
      // A wrong key/URL must be visible in the panel, not a 500 in the server log.
      const status = problem instanceof PterodactylError ? problem.status : 0;
      const hint = problem instanceof PterodactylError ? problem.hint : undefined;
      return Response.json({
        ok: true,
        configured: true,
        url,
        keyLooksValid,
        servers: [],
        error: problem instanceof Error ? problem.message : String(problem),
        status,
        hint: hint ?? keyHint,
      });
    }

    const linked = await listServers();
    const byIdentifier = new Map<string, string>();
    for (const server of linked) {
      if (server.pterodactyl) byIdentifier.set(server.pterodactyl.identifier, server.id);
    }

    return Response.json({
      ok: true,
      configured: true,
      url,
      keyLooksValid,
      hint: keyHint,
      servers: remote.map((server) => ({
        ...server,
        linkedPanelId: byIdentifier.get(server.identifier) ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
