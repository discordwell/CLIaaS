import Link from "next/link";
import FitText from "@/components/FitText";
import PublicNav from "@/components/PublicNav";

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
    <>
      <PublicNav />

    <main className="mx-auto w-full max-w-6xl px-6 py-16 text-foreground sm:px-10 sm:py-24">

      {/* ── Hero ── */}
      <header className="border-2 border-line bg-panel p-8 sm:p-14">
        <FitText
          lines={["AI lives in the command line", "Now, so does your helpdesk"]}
          maxSize={96}
          minSize={16}
          className="mt-2"
          lineClassNames={["text-muted", "text-foreground"]}
        />
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Import &amp; export tickets from Zendesk, Intercom, Freshdesk and more.
          Our tooling and data is designed, ground-up, for full AI interoperability.
          So answer a couple of tickets yourself, then tell OpenClaw to handle the rest.
        </p>
        <p className="mt-6 font-mono text-xs text-emerald-600 font-bold uppercase">
          Sign up by the Ides of March and get <span className="line-through">BYOC</span> Claudeus Maximus ∞. Free, Forever.
        </p>
      </header>

      {/* ── Terminal Demo ── */}
      <section className="mt-8 border-2 border-line bg-zinc-950 p-6 text-zinc-100 sm:p-10">
        {/* Claude Code header — mascot + version + model + dir */}
        <div className="mb-6 flex items-start gap-3 border-b-2 border-zinc-800 pb-5">
          {/* Pixel mascot */}
          <svg viewBox="0 0 16 16" className="mt-0.5 h-8 w-8 shrink-0" aria-hidden="true">
            <rect x="5" y="0" width="2" height="2" fill="#d97706" />
            <rect x="9" y="0" width="2" height="2" fill="#d97706" />
            <rect x="5" y="2" width="6" height="2" fill="#d97706" />
            <rect x="3" y="4" width="10" height="2" fill="#d97706" />
            <rect x="3" y="6" width="10" height="4" fill="#b45309" />
            <rect x="5" y="7" width="2" height="2" fill="#1e1e1e" />
            <rect x="9" y="7" width="2" height="2" fill="#1e1e1e" />
            <rect x="3" y="10" width="10" height="4" fill="#d97706" />
            <rect x="3" y="14" width="4" height="2" fill="#92400e" />
            <rect x="9" y="14" width="4" height="2" fill="#92400e" />
          </svg>
          <div className="font-mono text-xs leading-relaxed">
            <p><span className="font-bold text-zinc-200">Claude Code</span> <span className="text-zinc-500">v2.1.52</span></p>
            <p className="text-zinc-500">Opus 4.6 · Claude Max</p>
            <p className="text-zinc-500">~/Support/Zendesk/FML</p>
          </div>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-[1.8] text-zinc-300">
{/* ── Turn 1: Install ── */}
<span className="text-blue-400">{"● "}hi Claude, install cliaas</span>{"\n"}
{"\n"}
{"  "}<span className="text-blue-400">●</span> <span className="text-zinc-500">Explore</span>(<span className="text-zinc-400">Find CLIaaS install method</span>) <span className="text-zinc-600">Haiku 4.5</span>{"\n"}
{"  "}<span className="text-green-400">●</span> <span className="text-green-400">Done</span> <span className="text-zinc-600">(14 tool uses · 43.6k tokens · 33s)</span>{"\n"}
{"\n"}
{"  "}<span className="text-emerald-400">Bash</span>(<span className="text-zinc-400">npm install -g cliaas</span>){"\n"}
{"    "}<span className="text-zinc-500">added 1 package in 3s</span>{"\n"}
{"\n"}
{"  "}CLIaaS is installed and the MCP server is configured.{"\n"}
{"  "}Claude Code will auto-connect to all 18 MCP tools{"\n"}
{"  "}when working in this project.{"\n"}
{"\n"}
{/* ── Turn 2: Setup ── */}
<span className="text-blue-400">{"● "}okay now set up byoc locally</span>{"\n"}
{"\n"}
{"  "}<span className="text-blue-400">●</span> <span className="text-zinc-500">Read</span>(<span className="text-zinc-400">WIZARD/claude.md</span>){"\n"}
{"  "}<span className="text-blue-400">●</span> <span className="text-zinc-500">Bash</span>(<span className="text-zinc-400">cliaas setup init</span>){"\n"}
{"    "}<span className="text-green-400">✓</span> PostgreSQL connected (localhost:5432){"\n"}
{"    "}<span className="text-green-400">✓</span> Created database &apos;cliaas&apos;{"\n"}
{"    "}<span className="text-green-400">✓</span> Ran 42 migrations{"\n"}
{"    "}<span className="text-green-400">✓</span> LLM provider: openai (OPENAI_API_KEY set){"\n"}
{"    "}<span className="text-zinc-500">+2 lines (ctrl+e to expand)</span>{"\n"}
{"\n"}
{"  "}Your BYOC instance is ready. I followed the setup{"\n"}
{"  "}instructions in WIZARD/claude.md — database, migrations,{"\n"}
{"  "}and LLM provider are all configured.{"\n"}
{"\n"}
{/* ── Turn 3: Sync ── */}
<span className="text-blue-400">{"● "}cool my Zendesk API key is •••••••• download all my tickets</span>{"\n"}
{"\n"}
{"  "}<span className="text-blue-400">●</span> <span className="text-zinc-500">Bash</span>(<span className="text-zinc-400">cliaas sync pull zendesk --full</span>){"\n"}
{"    "}<span className="text-green-400">✓</span> 2,847 tickets synced (4.2s){"\n"}
{"    "}<span className="text-green-400">✓</span> 11,923 messages imported{"\n"}
{"    "}<span className="text-green-400">✓</span> Next sync: incremental (cursor saved){"\n"}
{"\n"}
{"  "}All 2,847 tickets and 11,923 messages are synced. Future{"\n"}
{"  "}syncs will be incremental — cursor is saved.
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
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
                <span className="line-through">BYOC</span>
              </p>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" className="text-emerald-500"><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 1 0 0-8c-2 0-4 1.33-6 4Z"/></svg>
            </div>
            <p className="mt-4 text-3xl font-bold uppercase text-foreground">
              Self-Hosted
            </p>
            <p className="mt-1 text-lg font-bold text-muted">
              Free Forever<span className="text-sm font-normal">*</span>
            </p>
            <ul className="mt-6 flex-1 space-y-3 text-sm font-medium text-muted">
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-muted"></span> Your infra, your data</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-muted"></span> Unrestricted CLI & Web GUI</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-muted"></span> Unlimited tickets & agents</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-muted"></span> Bring your own AI models</li>
            </ul>
            <Link
              href="/sign-up"
              className="mt-8 block border-2 border-line bg-foreground py-3 text-center font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
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
              <span className="text-lg line-through text-muted">$79</span>{" "}
              <span>$59</span><span className="text-base font-normal text-muted">/mo</span>
            </p>
            <p className="mt-1 font-mono text-xs text-emerald-600 font-bold">
              Early adopter lifetime discount
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
              <li className="pl-[18px]">Everything in BYOC</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> 10,000 tickets/mo</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Unlimited AI queries</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Full fancy GUI</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> We manage your infra</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Priority support</li>
            </ul>
            <Link
              href="/sign-up"
              className="mt-8 block border-2 border-line bg-foreground py-3 text-center font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
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
              <li className="pl-[18px]">Everything in Pro Hosted</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Unlimited everything</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> SSO / SAML / SCIM</li>
              <li className="flex items-start gap-3 text-foreground font-medium"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Dedicated support</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> Custom SLA guarantees</li>
              <li className="flex items-start gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-current"></span> On-prem deploy integration</li>
            </ul>
            <a
              href="mailto:hello@cliaas.com"
              className="mt-8 block border-2 border-line bg-foreground py-3 text-center font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
            >
              Let&apos;s Talk
            </a>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          * Must sign up, install, and migrate or process at least 10 tickets by
          March 15, 2026, 11:59 PM PST
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
    </>
  );
}

export default function Home() {
  const byoc = isByocMode();
  return byoc ? <ByocHome /> : <MarketingHome />;
}
