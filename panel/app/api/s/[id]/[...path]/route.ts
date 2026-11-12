import { errorResponse, requireViewer } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { callServer } from "@/lib/upstream";

export const dynamic = "force-dynamic";

/**
 * Everything the panel may do to one server, forwarded with that server's token.
 * The path allowlist keeps this from turning into an open proxy.
 */
const PATHS = new Set([
  "status",
  "players",
  "chat",
  "bans",
  "islands",
  "say",
  "dm",
  "kick",
  "kickall",
  "settings",
  "hostsettings",
  "host",
  "island",
  "command",
  "gamestate",
  "stop",
  "restart",
]);

export async function GET(request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  return forward(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  return forward(request, context);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  return forward(request, context);
}

async function forward(
  request: Request,
  context: { params: Promise<{ id: string; path: string[] }> },
): Promise<Response> {
  try {
    const { id, path } = await context.params;
    await requireViewer(id);

    const segments = Array.isArray(path) ? path : [];
    const endpoint = segments.join("/");
    if (!PATHS.has(endpoint)) {
      return Response.json({ ok: false, error: `endpoint not allowed: ${endpoint}` }, { status: 400 });
    }

    const server = (await listServers()).find((candidate) => candidate.id === id);
    if (!server) return Response.json({ ok: false, error: "unknown server" }, { status: 404 });

    const query = new URL(request.url).search;
    // DELETE carries the unban target in its body, so read it for anything but GET/HEAD.
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

    const result = await callServer(server, `/${endpoint}${query}`, {
      method: request.method,
      body: body && body.length > 0 ? body : undefined,
    });

    if (result.error !== undefined) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
