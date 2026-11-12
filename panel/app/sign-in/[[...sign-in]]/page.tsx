import { SignIn } from "@clerk/nextjs";
import { authMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  if (authMode !== "clerk") {
    return (
      <main className="center">
        <div className="card notice">
          <h2>Sign-in is not enabled</h2>
          <p className="muted">
            This build runs with <code>PANEL_DEV_AUTH</code> or without Clerk keys, so there is nothing to sign in to.
            Set the Clerk keys and remove <code>PANEL_DEV_AUTH</code> to use Discord sign-in.
          </p>
          <p>
            <a href="/">Back to the panel</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <SignIn />
    </main>
  );
}
