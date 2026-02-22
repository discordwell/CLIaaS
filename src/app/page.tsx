import Link from "next/link";

const coreFeatures = [
  {
    title: "Exfiltrate Everything",
    text: "Pull tickets, users, KB articles, macros, triggers, and SLA policies from Zendesk and Kayako via their real APIs. JSONL output, cursor-based sync.",
  },
  {
    title: "LLM-Powered Triage",
    text: "Feed your ticket queue to Claude, GPT-4o, or any OpenAI-compatible model. Get priority, category, and assignment suggestions in seconds.",
  },
  {
    title: "Draft, Suggest, Summarize",
    text: "Generate context-aware replies, surface relevant KB articles, and produce shift summaries — all from the terminal.",
  },
];

const providers = [
  { name: "Claude", desc: "Anthropic Claude Sonnet" },
  { name: "OpenAI", desc: "GPT-4o" },
  { name: "OpenClaw", desc: "Any OpenAI-compatible endpoint" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 text-slate-900 sm:px-10">
      <header className="rounded-3xl border border-slate-200/80 bg-panel/90 p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          CLIAAS.COM
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
          Replace your helpdesk UI with a CLI that actually works.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          CLIaaS exports your Zendesk and Kayako data, then runs LLM-powered
          triage, drafts, and KB suggestions from the terminal. No browser tabs.
          No per-seat licensing. Just your data and an LLM.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-full bg-accent px-6 py-3 font-semibold text-white transition hover:brightness-95"
          >
            Open Dashboard
          </Link>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold transition hover:bg-slate-50"
          >
            GitHub
          </a>
        </div>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {coreFeatures.map((feature) => (
          <article
            key={feature.title}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-xl font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{feature.text}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-300">
          Real CLI — Real APIs
        </p>
        <pre className="mt-3 overflow-x-auto font-mono text-sm leading-7 text-cyan-100">
{`$ cliaas zendesk export --subdomain acme --out ./data
Exporting tickets... 2,847 tickets exported (12,403 messages)
Exporting users... 342 users exported
Exporting organizations... 28 organizations exported
Exporting KB articles... 89 articles exported
Exporting business rules... 47 business rules exported

$ cliaas triage --limit 5
#4521 [URGENT] "Billing error on invoice #2026-0142" → billing, assign:sarah
#4519 [HIGH]   "Can't reset password"                → auth, assign:mike
#4518 [NORMAL] "Feature request: dark mode"           → product, assign:backlog
#4517 [NORMAL] "Slow load times on dashboard"         → engineering, assign:ops
#4515 [LOW]    "Update company address"               → admin, assign:support

$ cliaas draft reply --ticket 4521 --tone professional
Draft: "Hi Sarah, I've reviewed invoice #INV-2026-0142 and can confirm
the billing discrepancy. I've issued a corrective credit of $47.50
which will appear on your next statement..."
[approve] [edit] [discard]`}
        </pre>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">LLM Providers</h2>
        <p className="mt-2 text-sm text-muted">
          Choose your model. All three providers use the same prompt pipeline.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {providers.map((p) => (
            <div
              key={p.name}
              className="rounded-lg border border-slate-200 px-4 py-3"
            >
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-muted">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Routes</h2>
        <div className="mt-4 grid gap-2 font-mono text-sm">
          {[
            { path: "/dashboard", note: "connector status + quickstart" },
            { path: "/settings", note: "credentials + LLM provider config" },
            { path: "/api/health", note: "deploy healthcheck" },
            { path: "/api/connectors", note: "Zendesk + Kayako connector specs" },
          ].map((route) => (
            <div
              key={route.path}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
            >
              <Link href={route.path} className="text-accent underline-offset-2 hover:underline">
                {route.path}
              </Link>
              <span className="text-muted">{route.note}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
