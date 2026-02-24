import Link from "next/link";
import { loadTickets, computeStats } from "@/lib/data";
import { getAllConnectorStatuses } from "@/lib/connector-service";

export const dynamic = "force-dynamic";

const modules = [
  { path: "/tickets", name: "Tickets", gated: false },
  { path: "/customers", name: "Customers", gated: false },
  { path: "/kb", name: "Knowledge Base", gated: false },
  { path: "/analytics", name: "Analytics", gated: true },
  { path: "/ai", name: "AI Dashboard", gated: true },
  { path: "/automation", name: "Automation", gated: true },
  { path: "/sla", name: "SLA Policies", gated: true },
  { path: "/billing", name: "Billing & Plans", gated: false },
];

export default async function DashboardPage() {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  const connectors = getAllConnectorStatuses();

  const statCards = [
    { label: "Total Tickets", value: stats.total },
    { label: "Open", value: stats.byStatus["open"] ?? 0 },
    { label: "Urgent", value: stats.byPriority["urgent"] ?? 0 },
    { label: "Pending", value: stats.byStatus["pending"] ?? 0 },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-foreground">
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              Control Plane
            </p>
            <h1 className="mt-4 text-4xl font-bold">Workspace Status</h1>
          </div>
          <Link
            href="/settings"
            className="border-2 border-line bg-panel px-6 py-2 font-mono text-sm font-bold uppercase text-foreground hover:bg-accent-soft text-center"
          >
            Settings
          </Link>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="border-2 border-line bg-panel p-5 text-center"
          >
            <p className="font-mono text-3xl font-bold">{s.value}</p>
            <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {stats.recentTickets.length > 0 && (
        <section className="mt-8 border-2 border-line bg-panel p-8">
          <h2 className="text-2xl font-bold">Recent Tickets</h2>
          <div className="mt-4 flex flex-col gap-2 font-mono text-sm">
            {stats.recentTickets.slice(0, 8).map((t) => (
              <Link
                key={t.id}
                href={`/tickets/${t.id}`}
                className="flex items-center justify-between border-2 border-line p-3 transition-colors hover:bg-accent-soft"
              >
                <span className="truncate font-bold">{t.subject}</span>
                <span className="ml-4 flex shrink-0 items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${
                      t.priority === "urgent"
                        ? "bg-red-500 text-white"
                        : t.priority === "high"
                          ? "bg-orange-400 text-black"
                          : "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {t.priority}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${
                      t.status === "open"
                        ? "bg-emerald-400 text-black"
                        : t.status === "pending"
                          ? "bg-yellow-400 text-black"
                          : "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {t.status}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">System Modules</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 font-mono text-sm">
          {modules.map((m) => (
            <Link
              key={m.path}
              href={m.path}
              className="flex flex-col border-2 border-line p-4 transition-colors hover:bg-accent-soft"
            >
              <span className="font-bold text-foreground">{m.path}</span>
              <span className={`mt-2 font-bold uppercase tracking-wider text-[10px] ${m.gated ? "text-emerald-600" : "text-muted"}`}>
                {m.gated ? "PRO / ENTERPRISE" : "CORE FREE"}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Connections</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {connectors.filter((c) => c.configured || c.hasExport).length > 0 ? (
            connectors
              .filter((c) => c.configured || c.hasExport)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between border-2 border-line p-5">
                  <div>
                    <span className="font-bold text-lg">{c.name}</span>
                    {c.ticketCount > 0 && (
                      <span className="ml-3 font-mono text-xs text-muted">
                        {c.ticketCount} tickets
                      </span>
                    )}
                  </div>
                  <span
                    className={`px-3 py-1 font-mono text-xs font-bold uppercase border-2 border-line ${
                      c.configured
                        ? "bg-emerald-400 text-black"
                        : "bg-yellow-400 text-black"
                    }`}
                  >
                    {c.configured ? "Active" : "Export Only"}
                  </span>
                </div>
              ))
          ) : (
            <p className="col-span-2 font-mono text-sm text-muted">
              No connectors configured. Run <code className="text-foreground">cliaas sync</code> to set up a connector.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">CLI Reference</h2>
        <div className="mt-6 flex flex-col gap-4 font-mono text-sm">
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas triage</span>
            <span className="text-zinc-500">Auto-triage inbox</span>
          </div>
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas draft</span>
            <span className="text-zinc-500">Generate reply</span>
          </div>
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas kb suggest</span>
            <span className="text-zinc-500">Search articles</span>
          </div>
          <div className="flex justify-between">
            <span className="text-emerald-400">cliaas summarize</span>
            <span className="text-zinc-500">Shift report</span>
          </div>
        </div>
      </section>
    </main>
  );
}
