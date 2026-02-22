import Link from "next/link";
import { loadTickets, computeStats } from "@/lib/data";

const connectors = [
  {
    name: "Zendesk",
    direction: "bidirectional",
    state: "ready",
    cli: "cliaas zendesk export --subdomain <x> --email <e> --token <t> --out ./exports/zendesk",
  },
  {
    name: "Kayako",
    direction: "bidirectional",
    state: "ready",
    cli: "cliaas kayako export --domain <x> --email <e> --password <p> --out ./exports/kayako",
  },
];

const workflows = [
  { cmd: "cliaas triage --limit 10", desc: "LLM-powered ticket triage" },
  { cmd: "cliaas draft reply --ticket <id>", desc: "Generate context-aware reply" },
  { cmd: "cliaas kb suggest --ticket <id>", desc: "Surface relevant KB articles" },
  { cmd: "cliaas summarize --period today", desc: "Shift/queue summary" },
];

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

export default async function DashboardPage() {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  const hasData = tickets.length > 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950">
          Dashboard
        </p>
        <h1 className="mt-4 text-4xl font-bold">CLIaaS Control Plane</h1>
        <p className="mt-4 text-lg font-medium text-zinc-600">
          Export data from Zendesk and Kayako, then run LLM-powered workflows
          from the CLI.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/settings"
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800"
          >
            Settings
          </Link>
          <Link
            href="/demo"
            className="border-2 border-zinc-950 bg-white px-6 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            Try Demo
          </Link>
          <Link
            href="/"
            className="border-2 border-zinc-950 bg-white px-6 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            Home
          </Link>
        </div>
      </header>

      {/* STATS CARDS */}
      {hasData && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Tickets" value={stats.total} />
          <StatCard
            label="Open"
            value={stats.byStatus["open"] ?? 0}
            accent="text-blue-600"
          />
          <StatCard
            label="Urgent"
            value={stats.byPriority["urgent"] ?? 0}
            accent="text-red-600"
          />
          <StatCard
            label="Pending"
            value={stats.byStatus["pending"] ?? 0}
            accent="text-amber-600"
          />
        </section>
      )}

      {/* BY-STATUS + BY-PRIORITY */}
      {hasData && (
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">By Status</h2>
            <div className="mt-4 space-y-3">
              {Object.entries(stats.byStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor[status] ?? "bg-zinc-200 text-black"}`}
                      >
                        {status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 bg-zinc-200">
                        <div
                          className="h-full bg-zinc-950"
                          style={{
                            width: `${(count / stats.total) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-sm font-bold">
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </section>

          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">By Priority</h2>
            <div className="mt-4 space-y-3">
              {["urgent", "high", "normal", "low"]
                .filter((p) => stats.byPriority[p])
                .map((priority) => (
                  <div key={priority} className="flex items-center justify-between">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${priorityColor[priority]}`}
                    >
                      {priority}
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 bg-zinc-200">
                        <div
                          className="h-full bg-zinc-950"
                          style={{
                            width: `${((stats.byPriority[priority] ?? 0) / stats.total) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-sm font-bold">
                        {stats.byPriority[priority]}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}

      {/* ASSIGNEE BREAKDOWN */}
      {hasData && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-lg font-bold">By Assignee</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(stats.byAssignee)
              .sort(([, a], [, b]) => b - a)
              .map(([assignee, count]) => (
                <div
                  key={assignee}
                  className="flex items-center justify-between border border-zinc-200 px-4 py-2"
                >
                  <span className="text-sm font-bold">{assignee}</span>
                  <span className="font-mono text-sm text-zinc-500">
                    {count} tickets
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* TOP TAGS */}
      {hasData && stats.topTags.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-lg font-bold">Top Tags</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {stats.topTags.map(({ tag, count }) => (
              <span
                key={tag}
                className="border border-zinc-300 bg-zinc-100 px-3 py-1 font-mono text-xs font-bold"
              >
                {tag} ({count})
              </span>
            ))}
          </div>
        </section>
      )}

      {/* RECENT TICKETS TABLE */}
      {hasData && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
            <h2 className="text-lg font-bold">Recent Tickets</h2>
            <Link
              href="/tickets"
              className="font-mono text-xs font-bold uppercase text-blue-600 hover:underline"
            >
              View All
            </Link>
          </div>
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
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Priority
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Assignee
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-bold">
                      <Link href={`/tickets/${t.id}`} className="text-blue-600 hover:underline">
                        {t.externalId}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 font-medium">
                      <Link href={`/tickets/${t.id}`} className="hover:underline">
                        {t.subject}
                      </Link>
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
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* NO DATA STATE */}
      {!hasData && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
          <h2 className="text-xl font-bold">No ticket data found</h2>
          <p className="mt-3 text-sm font-medium text-zinc-600">
            Generate demo data or export from your helpdesk to see live metrics:
          </p>
          <pre className="mt-4 overflow-x-auto bg-zinc-950 p-4 font-mono text-sm text-emerald-400">
            {"$ cliaas demo generate --count 50\n"}
            {"$ cliaas zendesk export --subdomain acme --out ./exports/zendesk"}
          </pre>
        </section>
      )}

      {/* CONNECTORS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Connectors</h2>
        <div className="mt-6 space-y-4">
          {connectors.map((c) => (
            <div key={c.name} className="border-2 border-zinc-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <p className="text-lg font-bold">{c.name}</p>
                  <span className="bg-zinc-950 px-2 py-1 font-mono text-xs font-bold uppercase text-white">
                    {c.direction}
                  </span>
                </div>
                <span className="border-2 border-zinc-950 bg-emerald-400 px-3 py-1 font-mono text-xs font-bold uppercase text-black">
                  {c.state}
                </span>
              </div>
              <code className="mt-4 block border-t-2 border-zinc-200 bg-zinc-950 p-4 font-mono text-sm text-zinc-300">
                {c.cli}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* LLM WORKFLOWS */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">LLM Workflows</h2>
        <div className="mt-6 space-y-4">
          {workflows.map((w) => (
            <div
              key={w.cmd}
              className="flex flex-col gap-1 border-b-2 border-zinc-800 pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <code className="font-mono text-sm text-emerald-400">
                {w.cmd}
              </code>
              <span className="font-mono text-sm font-bold uppercase text-zinc-500">
                {w.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* QUICK START */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">Quick Start</h2>
        <pre className="mt-6 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-zinc-500">
            # 1. Configure your LLM provider
          </span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas config set-provider claude
          </span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas config set-key claude sk-ant-...
          </span>
          {"\n\n"}
          <span className="text-zinc-500">
            # 2. Export your helpdesk data
          </span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas zendesk export --subdomain acme --email you@acme.com --token
            &lt;key&gt; --out ./exports/zendesk
          </span>
          {"\n\n"}
          <span className="text-zinc-500"># 3. Work your queue</span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas tickets list --status open
          </span>
          {"\n"}
          <span className="text-emerald-400">cliaas triage --limit 10</span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas draft reply --ticket zd-4521 --tone professional
          </span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas kb suggest --ticket zd-4521
          </span>
          {"\n"}
          <span className="text-emerald-400">
            cliaas summarize --period today
          </span>
        </pre>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-zinc-950"}`}>
        {value}
      </p>
    </div>
  );
}
