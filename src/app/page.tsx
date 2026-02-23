import Link from "next/link";

const connectors = [
  { name: "Zendesk", status: "Live", desc: "Cursor-based incremental sync via REST API" },
  { name: "Kayako Cloud", status: "Live", desc: "Full export via HTTP client + offset pagination" },
  { name: "Kayako Classic", status: "Live", desc: "HMAC-SHA256 authenticated REST connector" },
  { name: "HelpCrunch", status: "Live", desc: "Bearer token auth, offset-paginated chat export" },
  { name: "Freshdesk", status: "Live", desc: "Basic auth, page-based pagination, KB hierarchy" },
  { name: "Groove", status: "Live", desc: "Bearer token, hypermedia-linked REST v1 API" },
];

const capabilities = [
  {
    title: "Ticket Management",
    tag: "Multi-Channel",
    items: [
      "Email inbound/outbound with threading",
      "Live chat widget with WebSocket",
      "Customer portal self-service",
      "REST API for programmatic access",
      "Internal notes and side conversations",
      "Custom fields and forms",
    ],
    link: "/tickets",
  },
  {
    title: "AI Intelligence",
    tag: "Multi-LLM",
    items: [
      "Autonomous ticket resolution",
      "Smart routing with skills matrix",
      "QA scoring and coaching",
      "Proactive anomaly detection",
      "Sentiment-aware escalation",
      "Per-category LLM routing",
    ],
    link: "/ai",
  },
  {
    title: "Automation Engine",
    tag: "Event-Driven",
    items: [
      "Triggers on create, update, reply",
      "One-click agent macros",
      "Time-based automations",
      "SLA policies with escalation chains",
      "Rule builder with audit logging",
      "CLI rule management",
    ],
    link: "/rules",
  },
  {
    title: "Real-time Collaboration",
    tag: "WebSocket",
    items: [
      "Agent collision detection",
      "Live presence indicators",
      "Activity feed per ticket",
      "@mention notifications",
      "Internal notes (agent-only)",
      "Typing indicators",
    ],
    link: "/tickets",
  },
  {
    title: "Analytics & Reporting",
    tag: "Dashboards",
    items: [
      "Real-time queue overview",
      "Agent performance metrics",
      "SLA compliance tracking",
      "Channel breakdown analysis",
      "CSV and PDF export",
      "Scheduled report delivery",
    ],
    link: "/analytics",
  },
  {
    title: "Integrations",
    tag: "Ecosystem",
    items: [
      "Webhook platform (in + out)",
      "Slack and Teams integration",
      "Plugin system with manifest API",
      "OpenAPI documentation",
      "Bidirectional real-time sync",
      "HMAC signature verification",
    ],
    link: "/integrations",
  },
  {
    title: "Customer Portal",
    tag: "Self-Service",
    items: [
      "Branded portal with custom CSS",
      "Ticket submission and tracking",
      "Knowledge base search",
      "CSAT and NPS surveys",
      "Multi-brand support",
      "Passwordless customer login",
    ],
    link: "/portal",
  },
  {
    title: "Enterprise",
    tag: "Compliance",
    items: [
      "Multi-brand / multi-portal",
      "Complete audit logging",
      "GDPR data export and deletion",
      "Data retention policies",
      "Sandbox environments",
      "Time tracking and billing",
    ],
    link: "/enterprise",
  },
];

const cliCommands = [
  { cmd: "cliaas triage", desc: "AI prioritization and categorization" },
  { cmd: "cliaas draft reply", desc: "Context-aware reply generation" },
  { cmd: "cliaas rules list", desc: "Manage automation rules" },
  { cmd: "cliaas ai-agent config", desc: "Configure autonomous resolution" },
  { cmd: "cliaas sla report", desc: "SLA compliance metrics" },
  { cmd: "cliaas sync start", desc: "Bidirectional platform sync" },
  { cmd: "cliaas qa report", desc: "Agent quality scoring" },
  { cmd: "cliaas stats --json | jq", desc: "Pipe-friendly analytics" },
];

const providers = [
  { name: "GPT-5.3", tag: "OpenAI", color: "bg-emerald-500" },
  { name: "Claude Opus 4.6", tag: "Anthropic", color: "bg-orange-500" },
  { name: "Claude Sonnet 4.6", tag: "Anthropic", color: "bg-orange-300" },
  { name: "Kimi K2.5", tag: "Moonshot AI", color: "bg-sky-500" },
  { name: "Gemini 3.1", tag: "Google", color: "bg-blue-500" },
];

const routes = [
  { path: "/dashboard", note: "live metrics" },
  { path: "/tickets", note: "ticket queue" },
  { path: "/analytics", note: "reporting dashboards" },
  { path: "/ai", note: "AI configuration" },
  { path: "/rules", note: "automation engine" },
  { path: "/chat", note: "live chat" },
  { path: "/kb", note: "knowledge base" },
  { path: "/portal", note: "customer portal" },
  { path: "/sla", note: "SLA policies" },
  { path: "/integrations", note: "webhooks + plugins" },
  { path: "/enterprise", note: "audit + compliance" },
  { path: "/docs", note: "CLI documentation" },
  { path: "/settings", note: "config + credentials" },
  { path: "/demo", note: "terminal playground" },
];

const stats = [
  { value: "6", label: "Phases Shipped" },
  { value: "35+", label: "Features Built" },
  { value: "10", label: "Connectors Live" },
  { value: "5", label: "LLM Providers" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 text-zinc-950 sm:px-10">
      {/* HERO */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-emerald-500"></div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Live on cliaas.com
          </p>
        </div>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-[0.95] sm:text-7xl">
          AI lives in the command line.
          <br />
          <span className="text-zinc-400">Now, so does your helpdesk.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-zinc-600">
          CLIaaS is a full-stack support platform built across 6 phases: auth,
          automation, AI agents, analytics, integrations, and enterprise
          compliance. CLI-first. Self-hosted. No per-seat fees.
        </p>
        <p className="mt-4 max-w-3xl text-base font-medium leading-relaxed text-zinc-500">
          35+ features spanning ticket management, autonomous AI resolution,
          real-time collaboration, customer self-service portals, SLA
          enforcement, and a plugin ecosystem. Every feature accessible from
          both the GUI and the command line.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="border-2 border-zinc-950 bg-zinc-950 px-8 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800"
          >
            Open Dashboard
          </Link>
          <Link
            href="/docs"
            className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            Read Docs
          </Link>
          <Link
            href="/demo"
            className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            Try Demo
          </Link>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            GitHub
          </a>
        </div>
      </header>

      {/* STATS BAR */}
      <section className="mt-8 grid grid-cols-2 gap-0 border-2 border-zinc-950 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`bg-white p-6 text-center ${
              i < stats.length - 1 ? "border-r-0 sm:border-r-2 sm:border-zinc-950" : ""
            } ${i < 2 ? "border-b-2 border-zinc-950 sm:border-b-0" : ""}`}
          >
            <p className="text-3xl font-bold sm:text-4xl">{s.value}</p>
            <p className="mt-1 font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {/* LIVE CLI DEMO */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Real CLI — Real APIs — Real LLM Output
          </p>
          <div className="flex gap-2">
            <div className="h-3 w-3 bg-red-500/60"></div>
            <div className="h-3 w-3 bg-yellow-500/60"></div>
            <div className="h-3 w-3 bg-green-500/60"></div>
          </div>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-emerald-400">$ cliaas zendesk export</span>
          {"\n"}
          {"  "}Exporting tickets... 26 tickets exported (26 messages){"\n"}
          {"  "}Exporting users... 3 users exported{"\n"}
          {"  "}Exporting KB articles... 1 article exported{"\n"}
          {"  "}Exporting business rules... 21 rules exported{"\n"}
          <span className="text-zinc-600">{"  "}Export complete → ./exports/zendesk/manifest.json</span>
          {"\n\n"}
          <span className="text-emerald-400">$ cliaas ai-agent --ticket zd-7</span>
          {"\n"}
          {"  "}
          <span className="text-zinc-500">Resolving autonomously...</span>
          {"\n"}
          {"  "}Context: 3 KB articles, 4 prior messages{"\n"}
          {"  "}Confidence: 0.94 (above threshold 0.85){"\n"}
          {"  "}
          <span className="text-emerald-400">Resolved</span>
          {" → password reset link sent to customer"}
          {"\n\n"}
          <span className="text-emerald-400">$ cliaas sla report --period 7d</span>
          {"\n"}
          {"  "}Response SLA: 96.2% (target 95%){" "}
          <span className="text-emerald-400">PASS</span>
          {"\n"}
          {"  "}Resolution SLA: 91.8% (target 90%){" "}
          <span className="text-emerald-400">PASS</span>
          {"\n"}
          {"  "}Breaches: 2 (both escalated within 5m){"\n"}
          {"  "}
          <span className="text-zinc-500">Full report → ./reports/sla-2026-02-23.csv</span>
        </pre>
      </section>

      {/* CAPABILITIES GRID */}
      <section className="mt-8">
        <div className="border-2 border-zinc-950 bg-zinc-50 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Platform Capabilities</h2>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
              6 phases / 35+ features
            </p>
          </div>
          <p className="mt-2 max-w-3xl text-sm font-medium text-zinc-600">
            Every feature works from both the web dashboard and the CLI.
            Self-hosted on your infrastructure with no per-seat pricing.
          </p>
        </div>
        <div className="grid gap-0 sm:grid-cols-2">
          {capabilities.map((cap) => (
            <Link
              key={cap.title}
              href={cap.link}
              className="group border-2 border-t-0 border-zinc-950 bg-white p-6 transition-colors hover:bg-zinc-50 sm:odd:border-r-0"
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {cap.tag}
                </p>
                <span className="font-mono text-xs font-bold uppercase text-zinc-300 transition-colors group-hover:text-zinc-950">
                  View
                </span>
              </div>
              <h3 className="mt-3 text-xl font-bold">{cap.title}</h3>
              <ul className="mt-3 flex flex-col gap-1.5">
                {cap.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm font-medium text-zinc-600"
                  >
                    <span className="mt-1.5 block h-1.5 w-1.5 flex-shrink-0 bg-zinc-300"></span>
                    {item}
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </section>

      {/* CLI-FIRST SECTION */}
      <section className="mt-8 grid gap-0 sm:grid-cols-2">
        <div className="border-2 border-zinc-950 bg-white p-6 sm:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Dual Interface
          </p>
          <h2 className="mt-3 text-2xl font-bold">CLI-First Architecture</h2>
          <p className="mt-4 text-sm font-medium leading-relaxed text-zinc-600">
            Every operation in CLIaaS works from both the web GUI and the
            command line. Pipe ticket data to jq. Script your triage workflow
            in bash. Compose with unix tools. Schedule reports via cron.
          </p>
          <p className="mt-3 text-sm font-medium leading-relaxed text-zinc-600">
            The CLI is not an afterthought bolted onto a SaaS product. It is
            the primary interface, with the GUI built on top of the same APIs.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800"
            >
              CLI Docs
            </Link>
            <Link
              href="/demo"
              className="border-2 border-zinc-950 bg-white px-6 py-2 font-mono text-xs font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
            >
              Try Terminal
            </Link>
          </div>
        </div>
        <div className="border-2 border-t-0 border-zinc-950 bg-zinc-950 p-6 sm:border-l-0 sm:border-t-2 sm:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Command Reference
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {cliCommands.map((c) => (
              <div key={c.cmd} className="flex flex-col gap-0.5">
                <code className="font-mono text-sm font-bold text-emerald-400">
                  $ {c.cmd}
                </code>
                <span className="font-mono text-xs text-zinc-500">{c.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONNECTORS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Connectors</h2>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            6 live integrations
          </p>
        </div>
        <p className="mt-2 text-sm font-medium text-zinc-500">
          Universal adapter for cross-platform migration. Export from any source,
          import to CLIaaS, with --cleanup reversal.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="border-2 border-zinc-200 p-4 transition-colors hover:border-zinc-950"
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-emerald-500"></div>
                <p className="font-mono text-xs font-bold uppercase text-emerald-600">
                  {c.status}
                </p>
              </div>
              <p className="mt-2 text-lg font-bold">{c.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BOTTOM ROW: PROVIDERS + ROUTES */}
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {/* LLM PROVIDERS */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">Frontier Models</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Multi-LLM support. Not locked to one AI vendor. Per-category
            routing: billing to GPT, technical to Claude.
          </p>
          <div className="mt-6 flex flex-col gap-4">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <div className={`h-3 w-3 ${p.color}`}></div>
                <div>
                  <p className="font-bold">{p.name}</p>
                  <p className="text-sm text-zinc-500">{p.tag}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ROUTES */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">Routes</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            {routes.length} live routes. Full-stack support platform.
          </p>
          <div className="mt-6 flex flex-col gap-3 font-mono text-sm">
            {routes.map((route) => (
              <div
                key={route.path}
                className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
              >
                <Link href={route.path} className="font-bold hover:underline">
                  {route.path}
                </Link>
                <span className="text-zinc-400">{route.note}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* COMPETITIVE POSITIONING */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6 sm:p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
          Why CLIaaS
        </p>
        <h2 className="mt-3 text-2xl font-bold">The Self-Hosted Alternative</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "No Per-Seat Fees",
              desc: "Self-hosted means unlimited agents at infrastructure cost. No $69-169/agent/month.",
            },
            {
              title: "Data Sovereignty",
              desc: "Your data stays on your server. GDPR-ready with built-in export, deletion, and retention policies.",
            },
            {
              title: "Multi-LLM Freedom",
              desc: "Not locked to one AI vendor. Route by category, fall back across providers, bring your own model.",
            },
            {
              title: "CLI Power",
              desc: "Script workflows in bash. Pipe output to jq. Schedule via cron. Compose with unix tools.",
            },
            {
              title: "Universal Migration",
              desc: "10 connectors for cross-platform migration. Import from any competitor, export to any other.",
            },
            {
              title: "Open Architecture",
              desc: "Plugin system, webhook platform, OpenAPI spec. Extend with anything. No walled garden.",
            },
          ].map((item) => (
            <div key={item.title} className="border-2 border-zinc-200 p-4">
              <p className="text-base font-bold">{item.title}</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-600">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-50 p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <h2 className="text-2xl font-bold">Start Building</h2>
            <p className="mt-2 text-sm font-medium text-zinc-600">
              Open the dashboard to manage tickets, configure AI agents, and
              set up automations. Or read the docs to get started with the CLI.
            </p>
          </div>
          <div className="flex flex-shrink-0 gap-4">
            <Link
              href="/dashboard"
              className="border-2 border-zinc-950 bg-zinc-950 px-8 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800"
            >
              Dashboard
            </Link>
            <Link
              href="/docs"
              className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
            >
              Docs
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-center">
        <p className="font-mono text-sm text-zinc-400">
          Built for{" "}
          <span className="font-bold text-white">Zachathon 2026</span> by
          Robert Cordwell
        </p>
      </footer>
    </main>
  );
}
