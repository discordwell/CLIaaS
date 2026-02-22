import Link from "next/link";
import { notFound } from "next/navigation";
import { loadTickets, loadMessages } from "@/lib/data";

const priorityColor: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-400 text-black",
  normal: "bg-yellow-300 text-black",
  low: "bg-zinc-300 text-black",
};

const statusColor: Record<string, string> = {
  open: "bg-blue-500 text-white",
  pending: "bg-amber-400 text-black",
  solved: "bg-emerald-500 text-white",
  closed: "bg-zinc-500 text-white",
};

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tickets = loadTickets();
  const ticket = tickets.find((t) => t.id === id || t.externalId === id);

  if (!ticket) notFound();

  const messages = loadMessages()
    .filter((m) => m.ticketId === ticket.id)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      {/* BREADCRUMB */}
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/tickets" className="hover:underline">
          Tickets
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">#{ticket.externalId}</span>
      </nav>

      {/* TICKET HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{ticket.subject}</h1>
            <p className="mt-2 font-mono text-sm text-zinc-500">
              #{ticket.externalId} &middot; {ticket.source} &middot; opened{" "}
              {new Date(ticket.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            <span
              className={`inline-block px-3 py-1 font-mono text-xs font-bold uppercase ${statusColor[ticket.status] ?? "bg-zinc-200 text-black"}`}
            >
              {ticket.status}
            </span>
            <span
              className={`inline-block px-3 py-1 font-mono text-xs font-bold uppercase ${priorityColor[ticket.priority] ?? "bg-zinc-200 text-black"}`}
            >
              {ticket.priority}
            </span>
          </div>
        </div>

        {/* METADATA */}
        <div className="mt-6 grid gap-4 border-t border-zinc-200 pt-6 sm:grid-cols-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Requester
            </p>
            <p className="mt-1 text-sm font-medium">{ticket.requester}</p>
          </div>
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Assignee
            </p>
            <p className="mt-1 text-sm font-medium">
              {ticket.assignee ?? "Unassigned"}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Updated
            </p>
            <p className="mt-1 text-sm font-medium">
              {new Date(ticket.updatedAt).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Tags
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {ticket.tags.length > 0 ? (
                ticket.tags.map((tag) => (
                  <span
                    key={tag}
                    className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-400">none</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* CONVERSATION THREAD */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-6">
          <h2 className="text-lg font-bold">
            Conversation ({messages.length} message
            {messages.length !== 1 ? "s" : ""})
          </h2>
        </div>

        {messages.length > 0 ? (
          <div className="divide-y divide-zinc-200">
            {messages.map((msg, idx) => (
              <div key={msg.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center bg-zinc-950 font-mono text-xs font-bold text-white">
                      {msg.author.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{msg.author}</p>
                      <p className="font-mono text-xs text-zinc-500">
                        {new Date(msg.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400">
                      #{idx + 1}
                    </span>
                    {msg.type === "note" && (
                      <span className="bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold text-amber-700">
                        Internal Note
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                  {msg.body}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-zinc-500">
            No messages in this ticket thread.
          </div>
        )}
      </section>

      {/* CLI ACTIONS */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
          CLI Actions
        </h3>
        <div className="mt-4 space-y-2 font-mono text-sm">
          <p>
            <span className="text-emerald-400">
              cliaas draft reply --ticket {ticket.id}
            </span>
            <span className="text-zinc-500"> # generate AI reply</span>
          </p>
          <p>
            <span className="text-emerald-400">
              cliaas kb suggest --ticket {ticket.id}
            </span>
            <span className="text-zinc-500"> # find relevant KB articles</span>
          </p>
          <p>
            <span className="text-emerald-400">
              cliaas triage --limit 1
            </span>
            <span className="text-zinc-500"> # AI priority suggestion</span>
          </p>
        </div>
      </section>
    </main>
  );
}
