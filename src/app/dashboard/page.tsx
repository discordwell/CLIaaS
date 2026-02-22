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
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-foreground">
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
          Dashboard
        </p>
        <h1 className="mt-4 text-4xl font-bold">CLIaaS Control Plane</h1>
        <p className="mt-4 text-lg font-medium text-muted">
          Export data from Zendesk and Kayako, then run LLM-powered workflows
          from the CLI.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/settings"
            className="border-2 border-line bg-inverted px-6 py-3 font-mono text-sm font-bold uppercase text-inverted-fg transition-opacity hover:opacity-80"
          >
            Settings
          </Link>
          <Link
            href="/api/connectors"
            className="border-2 border-line bg-panel px-6 py-3 font-mono text-sm font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
          >
            View Connectors JSON
          </Link>
        </div>
      </header>

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Connectors</h2>
        <div className="mt-6 space-y-4">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="border-2 border-line p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <p className="text-lg font-bold">{c.name}</p>
                  <span className="bg-inverted px-2 py-1 font-mono text-xs font-bold uppercase text-inverted-fg">
                    {c.direction}
                  </span>
                </div>
                <span className="border-2 border-line bg-emerald-400 px-3 py-1 font-mono text-xs font-bold uppercase text-black">
                  {c.state}
                </span>
              </div>
              <code className="mt-4 block border-t-2 border-line bg-zinc-950 p-4 font-mono text-sm text-zinc-300">
                {c.cli}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">LLM Workflows</h2>
        <div className="mt-6 space-y-4">
          {workflows.map((w) => (
            <div key={w.cmd} className="flex flex-col gap-1 border-b-2 border-zinc-800 pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <code className="font-mono text-sm text-emerald-400">{w.cmd}</code>
              <span className="font-mono text-sm font-bold uppercase text-zinc-500">{w.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">Quick Start</h2>
        <pre className="mt-6 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-zinc-500"># 1. Configure your LLM provider</span>{"\n"}
          <span className="text-emerald-400">cliaas config set-provider claude</span>{"\n"}
          <span className="text-emerald-400">cliaas config set-key claude sk-ant-...</span>{"\n\n"}

          <span className="text-zinc-500"># 2. Export your helpdesk data</span>{"\n"}
          <span className="text-emerald-400">cliaas zendesk export --subdomain acme --email you@acme.com --token &lt;key&gt; --out ./exports/zendesk</span>{"\n\n"}

          <span className="text-zinc-500"># 3. Work your queue</span>{"\n"}
          <span className="text-emerald-400">cliaas tickets list --status open</span>{"\n"}
          <span className="text-emerald-400">cliaas triage --limit 10</span>{"\n"}
          <span className="text-emerald-400">cliaas draft reply --ticket zd-4521 --tone professional</span>{"\n"}
          <span className="text-emerald-400">cliaas kb suggest --ticket zd-4521</span>{"\n"}
          <span className="text-emerald-400">cliaas summarize --period today</span>
        </pre>
      </section>
    </main>
  );
}
