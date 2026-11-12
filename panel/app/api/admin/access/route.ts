import { errorResponse, requireAdmin } from "@/lib/auth";
import { envAdminEmails, envAdminUserIds, envAllowedEmails, envAllowedUserIds } from "@/lib/config";
import { readAccess, writeAccess } from "@/lib/store";
import { z } from "zod";

export const dynamic = "force-dynamic";

const list = z.array(z.string().min(1)).max(200);

const accessInput = z.object({
  emails: list,
  userIds: list,
});

/** The editable part of the allowlist, plus what the environment pins. */
export async function GET() {
  try {
    await requireAdmin();
    const stored = await readAccess();
    return Response.json({
      ok: true,
      stored,
      env: {
        allowedEmails: envAllowedEmails,
        allowedUserIds: envAllowedUserIds,
        adminEmails: envAdminEmails,
        adminUserIds: envAdminUserIds,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const viewer = await requireAdmin();
    const parsed = accessInput.parse(await request.json());

    // Refuse an allowlist that would lock the current admin out of the panel.
    const self = viewer.email?.toLowerCase();
    const entries = [...parsed.emails, ...parsed.userIds].map((entry) => entry.toLowerCase());
    if (entries.length > 0 && !entries.includes(viewer.id.toLowerCase()) && !(self !== undefined && entries.includes(self))) {
      return Response.json(
        { ok: false, error: `this list does not include your own account (${viewer.email ?? viewer.id}) - it would lock you out` },
        { status: 400 },
      );
    }

    const saved = await writeAccess(parsed);
    return Response.json({ ok: true, stored: saved });
  } catch (error) {
    return errorResponse(error);
  }
}
