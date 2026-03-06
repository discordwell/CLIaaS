import Link from "next/link";
import { loadTickets, computeStats } from "@/lib/data";
import TicketListClient from "@/components/TicketListClient";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string; source?: string }>;
}) {
  const params = await searchParams;
  let tickets = await loadTickets();
  const stats = computeStats(tickets);

  // Collect unique sources for filter chips
  const allSources = [...new Set(tickets.map(t => t.source))];

  if (params.source) {
    tickets = tickets.filter((t) => t.source === params.source);
  }
  if (params.status) {
    tickets = tickets.filter((t) => t.status === params.status);
  }
  if (params.priority) {
    tickets = tickets.filter((t) => t.priority === params.priority);
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    tickets = tickets.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.requester.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  tickets.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Tickets
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
              {params.status && (
                <span className="ml-2 text-lg text-zinc-500">
                  ({params.status})
                </span>
              )}
            </h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Dashboard
            </Link>
            <Link
              href="/tickets"
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              All
            </Link>
          </div>
        </div>

        {/* Filter chips */}
        <div className="mt-6 flex flex-wrap gap-2">
          {["open", "pending", "solved", "closed"].map((s) => (
            <Link
              key={s}
              href={`/tickets?status=${s}`}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                params.status === s
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {s} ({stats.byStatus[s] ?? 0})
            </Link>
          ))}
          <span className="mx-2 self-center text-zinc-300">|</span>
          {allSources.map((src) => (
            <Link
              key={src}
              href={`/tickets?source=${src}`}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                params.source === src
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {src}
            </Link>
          ))}
          <span className="mx-2 self-center text-zinc-300">|</span>
          {["urgent", "high", "normal", "low"].map((p) => (
            <Link
              key={p}
              href={`/tickets?priority=${p}`}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                params.priority === p
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {p} ({stats.byPriority[p] ?? 0})
            </Link>
          ))}
        </div>
      </header>

      {/* TICKET TABLE */}
      {tickets.length > 0 ? (
        <TicketListClient
          tickets={tickets.map((t) => ({
            id: t.id,
            externalId: t.externalId,
            subject: t.subject,
            source: t.source,
            status: t.status,
            priority: t.priority,
            assignee: t.assignee,
            requester: t.requester,
            createdAt: t.createdAt,
            mergedIntoTicketId: t.mergedIntoTicketId,
          }))}
        />
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No tickets found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Generate demo data: <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">cliaas demo generate</code>
          </p>
        </section>
      )}
    </main>
  );
}
