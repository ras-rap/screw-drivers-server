import { notFound } from "next/navigation";
import { HttpError, requireViewer } from "@/lib/auth";
import { listServers } from "@/lib/store";
import { ServerView } from "../../components/ServerView";

export const dynamic = "force-dynamic";

export default async function ServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await requireViewer(id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    return (
      <main className="center">
        <div className="card notice">
          <h2>No access</h2>
          <p className="muted">{error instanceof Error ? error.message : "unexpected error"}</p>
          <p>
            <a href="/">Back to the panel</a>
          </p>
        </div>
      </main>
    );
  }

  const servers = await listServers();
  const server = servers.find((candidate) => candidate.id === id);
  if (!server) notFound();

  return <ServerView id={server.id} name={server.name} />;
}
