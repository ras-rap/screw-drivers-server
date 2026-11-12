import { auth, currentUser } from "@clerk/nextjs/server";
import {
  authMode,
  envAdminEmails,
  envAdminUserIds,
  envAllowedEmails,
  envAllowedUserIds,
} from "./config";
import { listServers, readAccess, StoreError, type ManagedServer } from "./store";

export type Viewer = {
  id: string;
  email?: string;
  name?: string;
  label: string;
  dev: boolean;
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The signed-in user, or null when anonymous / misconfigured. */
export async function getViewer(): Promise<Viewer | null> {
  if (authMode === "dev") {
    return { id: "dev", email: "dev@localhost", name: "dev", label: "dev (auth bypass)", dev: true };
  }
  if (authMode === "off") return null;

  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  const name = user?.fullName ?? user?.username ?? undefined;
  return { id: userId, email, name, label: name || email || userId, dev: false };
}

/** Matching is done against lowercase Clerk ids/emails; an empty list means "everyone". */
function matches(viewer: Viewer, list: string[]): boolean {
  const email = viewer.email?.toLowerCase();
  return (
    list.includes(viewer.id.toLowerCase()) || (email !== undefined && list.includes(email))
  );
}

/** Panel allowlist = environment lists ∪ the list an admin maintains in the panel. */
async function panelAccess(): Promise<{ emails: string[]; userIds: string[] }> {
  const stored = await readAccess();
  return {
    emails: [...envAllowedEmails, ...stored.emails.map((entry) => entry.toLowerCase())],
    userIds: [...envAllowedUserIds, ...stored.userIds.map((entry) => entry.toLowerCase())],
  };
}

/** Admins are configured in the environment only, so a compromised panel cannot mint admins. */
export function isAdmin(viewer: Viewer): boolean {
  return matches(viewer, [...envAdminEmails, ...envAdminUserIds]);
}

/** Route/page guard: 401 when anonymous, 403 when the account or the server is off-limits. */
export async function requireViewer(serverId?: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new HttpError(401, "not signed in");

  const access = await panelAccess();
  if (access.emails.length > 0 || access.userIds.length > 0) {
    const email = viewer.email?.toLowerCase();
    const onPanel =
      access.userIds.includes(viewer.id.toLowerCase()) || (email !== undefined && access.emails.includes(email));
    if (!onPanel) throw new HttpError(403, "this account is not allowed to use the panel");
  }

  if (serverId !== undefined) {
    const server = (await listServers()).find((candidate) => candidate.id === serverId);
    if (!server) throw new HttpError(404, "unknown server");
    if (server.allowed !== undefined && server.allowed.length > 0 && !matches(viewer, server.allowed.map((entry) => entry.toLowerCase()))) {
      throw new HttpError(403, "no access to this server");
    }
  }

  return viewer;
}

/** Guard for the admin pages and `/api/admin/*`. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) {
    throw new HttpError(
      403,
      "this account is not a panel admin - set PANEL_ADMIN_EMAILS or PANEL_ADMIN_USER_IDS in the environment and restart",
    );
  }
  return viewer;
}

/** Servers this viewer may see (per-server allowlists narrow the panel list). */
export async function visibleServers(viewer: Viewer): Promise<ManagedServer[]> {
  return (await listServers()).filter((server) => {
    if (server.allowed === undefined || server.allowed.length === 0) return true;
    return matches(viewer, server.allowed.map((entry) => entry.toLowerCase()));
  });
}

/** Turns a thrown HttpError/StoreError into a JSON response; logs and 500s anything else. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof StoreError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error("[panel] unexpected error", error);
  return Response.json({ ok: false, error: "internal error" }, { status: 500 });
}
