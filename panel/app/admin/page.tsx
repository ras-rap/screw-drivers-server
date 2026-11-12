import Link from "next/link";
import { HttpError, isAdmin, requireAdmin } from "@/lib/auth";
import { envAdminEmails, envAdminUserIds } from "@/lib/config";
import { AdminConsole } from "@/app/components/AdminConsole";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    const viewer = await requireAdmin();
    return <AdminConsole viewerLabel={viewer.label} />;
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "unexpected error";
    return (
      <main className="center">
        <div className="card notice">
          <h2>Admins only</h2>
          <p className="muted">{message}</p>
          <p className="muted">
            Add your own account to <code>PANEL_ADMIN_EMAILS</code> or <code>PANEL_ADMIN_USER_IDS</code> in the
            panel&apos;s environment and restart it.
            {envAdminEmails.length + envAdminUserIds.length === 0
              ? " No admin is configured yet, so nobody can open this page."
              : ` Currently configured: ${[...envAdminEmails, ...envAdminUserIds].join(", ")}.`}
          </p>
          <p>
            <Link href="/">Back to the panel</Link>
          </p>
        </div>
      </main>
    );
  }
}
