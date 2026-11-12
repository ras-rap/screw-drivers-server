import { errorResponse, requireAdmin } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { callServer } from "@/lib/upstream";
import { z } from "zod";

export const dynamic = "force-dynamic";

const change = z.object({
  section: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
});

/** ModTheIsland settings of one server (Discord hook, rate limits, guards). Admin only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const server = (await listServers()).find((candidate) => candidate.id === id);
    if (!server) return Response.json({ ok: false, error: "unknown server" }, { status: 404 });

    const result = await callServer(server, "/config");
    if (result.error !== undefined) {
      return Response.json({ ok: false, error: result.error }, { status: 502 });
    }
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** One setting at a time; the mod applies it and reloads the affected guard. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const server = (await listServers()).find((candidate) => candidate.id === id);
    if (!server) return Response.json({ ok: false, error: "unknown server" }, { status: 404 });

    const body = change.parse(await request.json());
    const result = await callServer(server, "/config", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (result.error !== undefined) {
      return Response.json({ ok: false, error: result.error }, { status: 502 });
    }
    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
