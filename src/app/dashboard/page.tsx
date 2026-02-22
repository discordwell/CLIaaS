import Link from "next/link";

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

export default function DashboardPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-semibold">CLIaaS Control Plane</h1>
        <p className="mt-2 text-muted">
          Export data from Zendesk and Kayako, then run LLM-powered workflows
          from the CLI.
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
        <h2 className="text-xl font-semibold">Connectors</h2>
        <div className="mt-4 space-y-3">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="rounded-lg border border-slate-200 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <p className="font-semibold">{c.name}</p>
                  <span className="font-mono text-xs text-muted">{c.direction}</span>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {c.state}
                </span>
              </div>
              <code className="mt-2 block rounded bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-700">
                {c.cli}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100 shadow-sm">
        <h2 className="text-xl font-semibold">LLM Workflows</h2>
        <div className="mt-4 space-y-3">
          {workflows.map((w) => (
            <div key={w.cmd} className="flex flex-wrap items-center justify-between gap-2">
              <code className="font-mono text-sm text-cyan-100">{w.cmd}</code>
              <span className="text-sm text-slate-400">{w.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100 shadow-sm">
        <h2 className="text-xl font-semibold">Quick Start</h2>
        <pre className="mt-3 overflow-x-auto font-mono text-sm leading-7 text-cyan-100">
{`# 1. Configure your LLM provider
cliaas config set-provider claude
cliaas config set-key claude sk-ant-...

# 2. Export your helpdesk data
cliaas zendesk export --subdomain acme --email you@acme.com --token <key> --out ./exports/zendesk

# 3. Work your queue
cliaas tickets list --status open
cliaas triage --limit 10
cliaas draft reply --ticket zd-4521 --tone professional
cliaas kb suggest --ticket zd-4521
cliaas summarize --period today`}
        </pre>
      </section>
    </main>
  );
}
