import Link from "next/link";

/**
 * Detect BYOC mode: CLIAAS_MODE=local means self-hosted instance.
 * In BYOC mode we show a simplified dashboard hub instead of marketing.
 */
function isByocMode(): boolean {
  const mode = process.env.CLIAAS_MODE;
  return mode === 'local';
}

/* ── Connector logos (names only — no images needed for brutalist aesthetic) ── */

const CONNECTORS = [
  "Zendesk",
  "Intercom",
  "Freshdesk",
  "HelpScout",
  "HubSpot",
  "Zoho Desk",
];

/* ── BYOC Home (self-hosted instances) ─────────────────────────────────────── */

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
          href="/tickets"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Tickets</h2>
          <p className="mt-2 text-sm text-muted">
            Browse, search, and manage support tickets.
          </p>
        </Link>
        <Link
          href="/analytics"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">Analytics</h2>
          <p className="mt-2 text-sm text-muted">
            Volume trends, response times, and CSAT metrics.
          </p>
        </Link>
        <Link
          href="/ai"
          className="border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
        >
          <h2 className="font-mono text-sm font-bold uppercase">AI Tools</h2>
          <p className="mt-2 text-sm text-muted">
            Triage, draft replies, sentiment, and more.
          </p>
        </Link>
        <Link
          href="/kb"
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

/* ── Marketing Home (public landing page) ──────────────────────────────────── */

function MarketingHome() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 text-foreground sm:px-10 sm:py-24">

      {/* ── Hero ── */}
      <header className="border-2 border-line bg-panel p-8 sm:p-14">
        <p className="font-mono text-sm font-bold uppercase tracking-widest text-muted">
          AI lives in the command line
        </p>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
          Now, so does your helpdesk.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Import tickets from Zendesk, Intercom, Freshdesk and more.
          Triage, draft replies, and manage your queue from the CLI, an MCP
          server, or the web dashboard. Bring your own AI. Keep your own data.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/sign-up"
            className="border-2 border-line bg-foreground px-8 py-3.5 font-mono text-sm font-bold uppercase text-white transition-opacity hover:opacity-80"
          >
            Get Started Free
          </Link>
          <Link
            href="/sign-in"
            className="border-2 border-line bg-panel px-8 py-3.5 font-mono text-sm font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
          >
            Sign In
          </Link>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-3.5 font-mono text-sm font-bold uppercase text-muted transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
        <p className="mt-4 font-mono text-xs text-emerald-600 font-bold uppercase">
          Sign up before the March Equinox and BYOC stays free forever.
        </p>
      </header>

      {/* ── Terminal Demo ── */}
      <section className="mt-8 border-2 border-line bg-zinc-950 p-6 text-zinc-100 sm:p-10">
        <div className="mb-6 flex items-center gap-3 border-b-2 border-zinc-800 pb-4">
          <div className="flex gap-1.5">
            <span className="block h-3 w-3 rounded-full bg-zinc-700" />
            <span className="block h-3 w-3 rounded-full bg-zinc-700" />
            <span className="block h-3 w-3 rounded-full bg-zinc-700" />
          </div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            cliaas
          </p>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-[1.8] text-zinc-300">
          <span className="text-emerald-400">$ cliaas triage --limit 3</span>{"\n"}
          {"  "}#4521 <span className="text-red-400">[URGENT]</span> &quot;Billing error&quot;  <span className="text-zinc-600">&rarr;</span> assign:sarah{"\n"}
          {"  "}#4519 <span className="text-orange-400">[HIGH]</span>   &quot;Login failing&quot; <span className="text-zinc-600">&rarr;</span> assign:mike{"\n"}
          {"  "}#4518 <span className="text-yellow-400">[NORMAL]</span> &quot;Dark mode?&quot;    <span className="text-zinc-600">&rarr;</span> assign:backlog{"\n"}
          {"\n"}
          <span className="text-emerald-400">$ cliaas draft reply --ticket 4521</span>{"\n"}
          {"  "}Draft: &quot;Hi — I&apos;ve reviewed invoice #INV-2026-0142 and{"\n"}
          {"  "}issued a $49 credit to your account...&quot;{"\n"}
          {"  "}<span className="text-zinc-500">[approve]  [edit]  [discard]</span>{"\n"}
          {"\n"}
          <span className="text-emerald-400">$ cliaas queue stats</span>{"\n"}
          {"  "}Open: 23  Pending: 8  Urgent: 2  CSAT: 94%{"\n"}
          {"  "}Avg first response: 12m  Avg resolution: 4.2h
        </pre>
      </section>

      {/* ── Three interfaces ── */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="border-2 border-line bg-panel p-6 sm:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">01</p>
          <h2 className="mt-3 text-xl font-bold">CLI</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Triage, draft, search, and manage your queue without leaving the
            terminal. Pipe output. Script workflows. No browser required.
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-6 sm:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">02</p>
          <h2 className="mt-3 text-xl font-bold">MCP Server</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            30 tools that plug into Claude Code, Cursor, Windsurf, or any MCP
            client. Your helpdesk becomes a tool your AI assistant can use.
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-6 sm:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">03</p>
          <h2 className="mt-3 text-xl font-bold">Web Dashboard</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Full GUI when you need it. Tickets, analytics, KB, AI tools,
            automation rules, SLA tracking, and billing.
          </p>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section className="mt-8 border-2 border-line bg-panel p-8 sm:p-10">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
          Capabilities
        </p>
        <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["AI Triage", "Auto-classify priority, category, and assignee with your LLM."],
            ["Draft Replies", "Generate context-aware responses using ticket history and KB articles."],
            ["Sentiment Analysis", "Detect frustrated customers before they churn."],
            ["Queue Management", "Stats, SLA tracking, shift summaries from the command line."],
            ["Knowledge Base", "Search, suggest articles, and RAG-powered answers."],
            ["Duplicate Detection", "Catch duplicate tickets before agents waste time on them."],
            ["Connector Sync", "Continuous sync from 10+ platforms. Not a one-time import."],
            ["Automation Rules", "Triggers, macros, and automations. Build once, run forever."],
            ["Compliance", "GDPR data retention, audit logs, and evidence export."],
          ].map(([title, desc]) => (
            <div key={title}>
              <h3 className="font-mono text-sm font-bold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Connectors ── */}
      <section className="mt-8 border-2 border-line bg-panel p-8 sm:p-10">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
          Import from
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {CONNECTORS.map((name) => (
            <span
              key={name}
              className="border-2 border-line px-4 py-2 font-mono text-sm font-bold"
            >
              {name}
            </span>
          ))}
          <span className="border-2 border-zinc-300 px-4 py-2 font-mono text-sm text-muted">
            + 4 more
          </span>
        </div>
        <p className="mt-4 text-sm text-muted">
          Continuous sync, not a one-time export. Cursor-based incremental
          updates keep your local data fresh.
        </p>
      </section>

      {/* ── MCP Highlight ── */}
      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100 sm:p-10">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
          MCP Server — 30 Tools
        </p>
        <h2 className="mt-4 text-2xl font-bold text-white sm:text-3xl">
          Your helpdesk is now an AI tool.
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
          CLIaaS ships an MCP server that exposes your entire support queue to
          any AI assistant. Ask Claude to triage your inbox. Let Cursor draft
          replies while you code. The same 30 tools work across every tier and
          deployment mode.
        </p>
        <div className="mt-6 grid gap-3 font-mono text-xs sm:grid-cols-2 lg:grid-cols-3">
          {[
            "tickets_list", "tickets_show", "tickets_search",
            "triage_ticket", "triage_batch", "draft_reply",
            "sentiment_analyze", "detect_duplicates", "summarize_queue",
            "kb_search", "kb_suggest", "rag_ask",
            "queue_stats", "sla_report", "sync_pull",
          ].map((tool) => (
            <span key={tool} className="text-emerald-400">{tool}</span>
          ))}
          <span className="text-zinc-600">+ 15 more</span>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="mt-8" id="pricing">
        <div className="border-2 border-line bg-panel p-8 sm:p-10">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
            Pricing
          </p>
          <p className="mt-3 text-sm text-muted">
            Self-hosted or cloud-hosted. Pick the plan that fits your team.
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {/* BYOC */}
          <div className="flex flex-col border-2 border-line bg-panel p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
              BYOC
            </p>
            <p className="mt-3 text-3xl font-bold">
              Free<span className="text-base font-normal text-muted">*</span>
            </p>
            <p className="mt-1 font-mono text-xs text-emerald-600 font-bold uppercase">
              Free forever for early adopters
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
              <li>Self-hosted — your machine, your data</li>
              <li>Full CLI + MCP server</li>
              <li>Full web dashboard</li>
              <li>Unlimited local tickets</li>
              <li>Bring your own DB + AI keys</li>
              <li>Community support</li>
            </ul>
            <Link
              href="/sign-up"
              className="mt-6 block border-2 border-line bg-foreground py-3 text-center font-mono text-xs font-bold uppercase text-white transition-opacity hover:opacity-80"
            >
              Get Started Free
            </Link>
          </div>

          {/* Pro Hosted */}
          <div className="flex flex-col border-2 border-foreground bg-panel p-6 ring-1 ring-foreground">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
              Pro Hosted
            </p>
            <p className="mt-3 text-3xl font-bold">
              $79<span className="text-base font-normal text-muted">/mo</span>
            </p>
            <p className="mt-1 font-mono text-xs text-muted">
              We host it, or hybrid with your machine
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
              <li>Everything in BYOC</li>
              <li className="text-foreground font-medium">10,000 tickets/mo</li>
              <li className="text-foreground font-medium">Unlimited AI queries</li>
              <li className="text-foreground font-medium">Full fancy GUI</li>
              <li className="text-foreground font-medium">We manage your infra</li>
              <li>Priority support</li>
            </ul>
            <Link
              href="/sign-up"
              className="mt-6 block border-2 border-line bg-foreground py-3 text-center font-mono text-xs font-bold uppercase text-white transition-opacity hover:opacity-80"
            >
              Start Pro Hosted
            </Link>
          </div>

          {/* Enterprise */}
          <div className="flex flex-col border-2 border-line bg-panel p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
              Enterprise
            </p>
            <p className="mt-3 text-3xl font-bold">
              Custom
            </p>
            <p className="mt-1 font-mono text-xs text-muted">
              For teams with &gt;10k tickets/mo
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
              <li>Everything in Pro Hosted</li>
              <li className="text-foreground font-medium">Unlimited everything</li>
              <li className="text-foreground font-medium">SSO / SAML / SCIM</li>
              <li className="text-foreground font-medium">Dedicated support</li>
              <li>Custom SLA guarantees</li>
              <li>On-prem or hybrid deploy</li>
            </ul>
            <a
              href="mailto:hello@cliaas.com"
              className="mt-6 block border-2 border-line py-3 text-center font-mono text-xs font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
            >
              Let&apos;s Talk
            </a>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          * Free forever if you sign up before the March Equinox (March 20, 2026)
          and either use an integration or process 10+ tickets.
        </p>
      </section>

      {/* ── Open Source CTA ── */}
      <section className="mt-8 border-2 border-line bg-panel p-8 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Open source. Ship it yourself.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              CLIaaS is MIT-licensed. Clone the repo, point it at your Postgres,
              add your LLM key, and you have a fully functional helpdesk in
              under five minutes. No vendor lock-in. No data leaves your machine.
            </p>
          </div>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 border-2 border-line px-8 py-3 font-mono text-sm font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="mt-16 flex flex-col items-center gap-4 pb-12 text-center">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
          CLIaaS
        </p>
        <div className="flex gap-6 font-mono text-xs text-muted">
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          <Link href="/sign-in" className="transition-colors hover:text-foreground">
            Sign In
          </Link>
          <a
            href="mailto:hello@cliaas.com"
            className="transition-colors hover:text-foreground"
          >
            Contact
          </a>
        </div>
      </footer>
    </main>
  );
}

export default function Home() {
  const byoc = isByocMode();
  return byoc ? <ByocHome /> : <MarketingHome />;
}
