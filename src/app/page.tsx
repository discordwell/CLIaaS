import Link from "next/link";

/**
 * Detect BYOC mode: CLIAAS_MODE=local, or DATABASE_URL present without
 * a hosted mode set. In BYOC mode we show a simplified dashboard hub
 * instead of marketing content.
 */
function isByocMode(): boolean {
  const mode = process.env.CLIAAS_MODE;
  // Only local mode is BYOC — db/remote/hybrid modes have their own UX
  return mode === 'local';
}

function ByocHome() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12 text-foreground sm:px-10">
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <p className="font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          BYOC INSTANCE
        </p>
        <h1 className="mt-4 text-3xl font-bold leading-none sm:text-5xl">
          CLIaaS
        </h1>
        <p className="mt-4 text-base font-medium text-muted">
          Self-hosted helpdesk management. CLI-first, Web-second.
        </p>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Dashboard</h2>
          <p className="mt-2 text-sm text-muted">
            View ticket queue, metrics, and team activity.
          </p>
        </Link>
        <Link
          href="/dashboard/tickets"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Tickets</h2>
          <p className="mt-2 text-sm text-muted">
            Browse, search, and manage support tickets.
          </p>
        </Link>
        <Link
          href="/dashboard/analytics"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Analytics</h2>
          <p className="mt-2 text-sm text-muted">
            Volume trends, response times, and CSAT metrics.
          </p>
        </Link>
        <Link
          href="/dashboard/ai"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">AI Tools</h2>
          <p className="mt-2 text-sm text-muted">
            Triage, draft replies, sentiment, and more.
          </p>
        </Link>
        <Link
          href="/dashboard/kb"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Knowledge Base</h2>
          <p className="mt-2 text-sm text-muted">
            Articles, categories, and search.
          </p>
        </Link>
        <Link
          href="/setup"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Setup</h2>
          <p className="mt-2 text-sm text-muted">
            Configure database, LLM provider, and connectors.
          </p>
        </Link>
      </section>

      <section className="mt-8 border-2 border-line bg-zinc-950 p-6 text-zinc-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between border-b-2 border-zinc-800 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Quick Commands
          </p>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-emerald-400">$ cliaas triage --limit 5</span>
          {"\n"}
          <span className="text-emerald-400">$ cliaas queue stats</span>
          {"\n"}
          <span className="text-emerald-400">$ cliaas sync status</span>
          {"\n"}
          <span className="text-emerald-400">$ cliaas draft reply --ticket &lt;id&gt;</span>
        </pre>
      </section>
    </main>
  );
}

function MarketingHome() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12 text-foreground sm:px-10">
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <p className="font-mono text-sm font-bold uppercase tracking-widest text-foreground">
          COMMAND-LINE NATIVE
        </p>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-none sm:text-7xl">
          Replace your helpdesk UI with a CLI.
        </h1>
        <p className="mt-6 max-w-2xl text-lg font-medium text-muted">
          Export your Zendesk and Kayako data locally, then run LLM-powered triage, drafts, and summaries straight from the terminal. Dual interface: CLI-first, Web-second.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="border-2 border-line bg-foreground px-8 py-3 font-mono text-sm font-bold uppercase text-background transition-opacity hover:opacity-80"
          >
            Open Dashboard
          </Link>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-line bg-panel px-8 py-3 font-mono text-sm font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
          >
            GitHub
          </a>
        </div>
      </header>

      <section className="mt-8 border-2 border-line bg-zinc-950 p-6 text-zinc-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between border-b-2 border-zinc-800 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Workflow Demo
          </p>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-emerald-400">$ cliaas triage --limit 3</span>{"\n"}
          #4521 <span className="text-red-400">[URGENT]</span> &quot;Billing error&quot; → assign:sarah{"\n"}
          #4519 <span className="text-orange-400">[HIGH]</span>   &quot;Login failing&quot; → assign:mike{"\n"}
          #4518 <span className="text-yellow-400">[NORMAL]</span> &quot;Dark mode?&quot;    → assign:backlog{"\n\n"}
          <span className="text-emerald-400">$ cliaas draft reply --ticket 4521</span>{"\n"}
          Draft: &quot;Hi Sarah, I&apos;ve reviewed invoice #INV-2026-0142 and issued a credit...&quot;{"\n"}
          <span className="text-zinc-500">[approve] [edit] [discard]</span>
        </pre>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-3">
        <div className="border-2 border-line bg-panel p-6">
          <h2 className="font-mono text-sm font-bold uppercase">BYOC (Free)</h2>
          <p className="mt-2 text-sm font-medium text-muted">Self-hosted. Local DB. You own the data. Full CLI + basic GUI.</p>
        </div>
        <div className="border-2 border-line bg-panel p-6">
          <h2 className="font-mono text-sm font-bold uppercase">Hosted (Paid)</h2>
          <p className="mt-2 text-sm font-medium text-muted">We manage infra. Full GUI + premium features (Analytics, AI Dashboard).</p>
        </div>
        <div className="border-2 border-line bg-panel p-6">
          <h2 className="font-mono text-sm font-bold uppercase">Hybrid</h2>
          <p className="mt-2 text-sm font-medium text-muted">Hosted source of truth + local sync. Perfect for enterprise resilience.</p>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const byoc = isByocMode();
  return byoc ? <ByocHome /> : <MarketingHome />;
}
