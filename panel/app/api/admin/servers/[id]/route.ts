import { errorResponse, requireAdmin } from "@/lib/auth";
import { deleteServer, serverInput, updateServer } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    const input = serverInput.parse(await request.json());
    const updated = await updateServer(id, input);
    const { token: _token, ...rest } = updated;
    return Response.json({ ok: true, server: { ...rest, source: "panel", hasToken: true, locked: false } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    await deleteServer(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
