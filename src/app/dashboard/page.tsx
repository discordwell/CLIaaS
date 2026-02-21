import Link from "next/link";

const statuses = [
  { job: "notion -> cliaas import", state: "ready", lastRun: "never" },
  { job: "cliaas -> csv export", state: "ready", lastRun: "never" },
  { job: "trello -> cliaas import", state: "building", lastRun: "never" },
];

export default function DashboardPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Workspace: hackathon-alpha</h1>
        <p className="mt-2 text-muted">
          Start with API stubs now, then replace with live provider adapters as the
          target SaaS is chosen.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/settings"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            Settings
          </Link>
          <Link
            href="/api/connectors"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            View Connectors JSON
          </Link>
        </div>
      </header>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Interop Jobs</h2>
        <div className="mt-4 space-y-3">
          {statuses.map((item) => (
            <div
              key={item.job}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-4 py-3"
            >
              <p className="font-mono text-sm">{item.job}</p>
              <div className="flex items-center gap-3 text-sm">
                <span
                  className={`rounded-full px-2 py-1 font-semibold ${
                    item.state === "ready"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {item.state}
                </span>
                <span className="text-muted">last run: {item.lastRun}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100 shadow-sm">
        <h2 className="text-xl font-semibold">CLI Quickstart</h2>
        <pre className="mt-3 overflow-x-auto font-mono text-sm leading-7 text-cyan-100">
{`cliaas auth login
cliaas connectors list
cliaas import --from notion --workspace hackathon-alpha --out ./tmp/notion.json
cliaas export --to csv --workspace hackathon-alpha --out ./tmp/export.csv`}
        </pre>
      </section>
    </main>
  );
}
