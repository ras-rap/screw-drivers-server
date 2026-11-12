import { authMode } from "@/lib/config";
import { errorResponse, isAdmin, requireViewer, visibleServers } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Registry as the browser may see it: never the tokens, only the servers this user can watch. */
export async function GET() {
  try {
    const viewer = await requireViewer();
    const servers = await visibleServers(viewer);
    return Response.json({
      ok: true,
      authMode,
      viewer: { label: viewer.label, email: viewer.email ?? null, dev: viewer.dev, admin: isAdmin(viewer) },
      servers: servers.map(({ token: _token, allowed, createdAt, updatedAt, ...rest }) => ({
        ...rest,
        hasToken: true,
        restricted: (allowed?.length ?? 0) > 0,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
