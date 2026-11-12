import { redirect } from "next/navigation";
import { getViewer, isAdmin } from "@/lib/auth";
import { authMode } from "@/lib/config";
import { Overview } from "./components/Overview";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await getViewer();

  if (!viewer) {
    if (authMode === "clerk") redirect("/sign-in");
    return (
      <main className="center">
        <div className="card notice">
          <h2>Panel is not configured for sign-in</h2>
          <p className="muted">
            Production needs <code>CLERK_SECRET_KEY</code> and <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>. For
            local work set <code>PANEL_DEV_AUTH=1</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <Overview
      viewer={{ label: viewer.label, email: viewer.email ?? null, dev: viewer.dev, admin: isAdmin(viewer) }}
      authMode={authMode}
    />
  );
}
