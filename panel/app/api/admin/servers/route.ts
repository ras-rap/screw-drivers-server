import { errorResponse, requireAdmin } from "@/lib/auth";
import { createServer, listServers, serverInput } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Full list for the admin page: includes provenance and whether a token is set, never the token. */
export async function GET() {
  try {
    await requireAdmin();
    const servers = await listServers();
    return Response.json({
      ok: true,
      servers: servers.map(({ token: _token, ...rest }) => ({
        ...rest,
        hasToken: true,
        locked: rest.source === "env",
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const input = serverInput.parse(await request.json());
    const created = await createServer(input);
    const { token: _token, ...rest } = created;
    return Response.json({ ok: true, server: { ...rest, source: "panel", hasToken: true, locked: false } });
  } catch (error) {
    return errorResponse(error);
  }
}
