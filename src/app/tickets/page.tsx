import Link from "next/link";
import { loadTickets, computeStats } from "@/lib/data";

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
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    ID
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Subject
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Source
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Priority
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Assignee
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Requester
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="font-mono text-xs font-bold text-blue-600 hover:underline"
                      >
                        {t.externalId}
                      </Link>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase bg-zinc-200 text-zinc-700">
                        {t.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor[t.status] ?? "bg-zinc-200 text-black"}`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${priorityColor[t.priority] ?? "bg-zinc-200 text-black"}`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {t.assignee ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {t.requester}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
