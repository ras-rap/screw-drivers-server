import { errorResponse, requireAdmin } from "@/lib/auth";
import { pterodactylConfig, powerSignal, setPower } from "@/lib/pterodactyl";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Power control for the Pterodactyl server behind a panel entry. Only useful when the
 * game is down - while it runs, use the server's own /restart and /stop.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const config = pterodactylConfig();
    if (config === null) {
      return Response.json(
        { ok: false, error: "Pterodactyl is not configured (PTERODACTYL_URL / PTERODACTYL_API_KEY)" },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const serverId = Number(id);
    if (!Number.isInteger(serverId) || serverId <= 0) {
      return Response.json({ ok: false, error: "invalid Pterodactyl server id" }, { status: 400 });
    }

    const parsed = z.object({ signal: powerSignal }).safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ ok: false, error: "signal must be start, stop, restart or kill" }, { status: 400 });
    }

    await setPower(config, serverId, parsed.data.signal);
    return Response.json({ ok: true, signal: parsed.data.signal });
  } catch (error) {
    return errorResponse(error);
  }
}
