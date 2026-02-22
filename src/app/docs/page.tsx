import Link from "next/link";

const cliCommands = [
  {
    name: "zendesk verify",
    desc: "Test Zendesk API connectivity and authentication",
    usage: "cliaas zendesk verify --subdomain <x> --email <e> --token <t>",
    flags: ["--subdomain", "--email", "--token"],
  },
  {
    name: "zendesk export",
    desc: "Export tickets, users, orgs, KB articles, and business rules from Zendesk",
    usage: "cliaas zendesk export --subdomain <x> --email <e> --token <t> --out ./exports/zendesk",
    flags: ["--subdomain", "--email", "--token", "--out"],
  },
  {
    name: "zendesk sync",
    desc: "Incremental sync using cursor state from a previous export",
    usage: "cliaas zendesk sync --out ./exports/zendesk",
    flags: ["--subdomain", "--email", "--token", "--out"],
  },
  {
    name: "zendesk update",
    desc: "Update a Zendesk ticket (status, priority, assignee, tags)",
    usage: "cliaas zendesk update --ticket <id> --status solved --priority high",
    flags: ["--ticket", "--status", "--priority", "--assignee", "--tags", "--subdomain", "--email", "--token"],
  },
  {
    name: "zendesk reply",
    desc: "Post a public reply or internal note to a Zendesk ticket",
    usage: "cliaas zendesk reply --ticket <id> --body \"Your issue has been resolved.\" [--internal]",
    flags: ["--ticket", "--body", "--internal", "--subdomain", "--email", "--token"],
  },
  {
    name: "zendesk create",
    desc: "Create a new Zendesk ticket",
    usage: "cliaas zendesk create --subject \"Bug report\" --body \"Steps to reproduce...\"",
    flags: ["--subject", "--body", "--priority", "--tags", "--assignee", "--subdomain", "--email", "--token"],
  },
  {
    name: "kayako verify",
    desc: "Test Kayako API connectivity and authentication",
    usage: "cliaas kayako verify --domain <x> --email <e> --password <p>",
    flags: ["--domain", "--email", "--password"],
  },
  {
    name: "kayako export",
    desc: "Export cases, users, orgs, and KB articles from Kayako",
    usage: "cliaas kayako export --domain <x> --email <e> --password <p> --out ./exports/kayako",
    flags: ["--domain", "--email", "--password", "--out"],
  },
  {
    name: "kayako update",
    desc: "Update a Kayako case (status, priority, assignee, tags)",
    usage: "cliaas kayako update --case <id> --status OPEN --priority HIGH",
    flags: ["--case", "--status", "--priority", "--assignee", "--tags", "--domain", "--email", "--password"],
  },
  {
    name: "kayako reply",
    desc: "Post a reply to a Kayako case",
    usage: "cliaas kayako reply --case <id> --body \"We're looking into this.\"",
    flags: ["--case", "--body", "--domain", "--email", "--password"],
  },
  {
    name: "kayako note",
    desc: "Post an internal note to a Kayako case",
    usage: "cliaas kayako note --case <id> --body \"Escalating to tier 2.\"",
    flags: ["--case", "--body", "--domain", "--email", "--password"],
  },
  {
    name: "kayako create",
    desc: "Create a new Kayako case",
    usage: "cliaas kayako create --subject \"New inquiry\" --body \"Customer needs help.\"",
    flags: ["--subject", "--body", "--priority", "--tags", "--domain", "--email", "--password"],
  },
  {
    name: "tickets list",
    desc: "List and filter exported tickets",
    usage: "cliaas tickets list [--status open] [--priority high] [--assignee <name>]",
    flags: ["--status", "--priority", "--assignee", "--tag", "--source", "--sort", "--limit", "--dir"],
  },
  {
    name: "tickets search",
    desc: "Full-text search across subjects, tags, requesters, and message bodies",
    usage: "cliaas tickets search <query>",
    flags: ["--dir", "--limit"],
  },
  {
    name: "tickets show",
    desc: "Show ticket details with conversation thread",
    usage: "cliaas tickets show <id>",
    flags: ["--dir"],
  },
  {
    name: "triage",
    desc: "LLM-powered ticket triage with priority, category, and assignment suggestions",
    usage: "cliaas triage [--queue open] [--limit 10]",
    flags: ["--queue", "--limit", "--dir"],
  },
  {
    name: "draft reply",
    desc: "Generate an AI draft reply for a ticket",
    usage: "cliaas draft reply --ticket <id> [--tone professional]",
    flags: ["--ticket", "--tone", "--context", "--dir"],
  },
  {
    name: "kb suggest",
    desc: "Surface relevant knowledge base articles for a ticket",
    usage: "cliaas kb suggest --ticket <id> [--top 3]",
    flags: ["--ticket", "--top", "--dir"],
  },
  {
    name: "summarize",
    desc: "Generate a shift/queue summary using LLM",
    usage: "cliaas summarize [--period today|shift|week]",
    flags: ["--period", "--dir"],
  },
  {
    name: "pipeline",
    desc: "One-shot: triage open tickets, then draft replies for top-priority items",
    usage: "cliaas pipeline [--limit 10] [--draft-top 3] [--dry-run]",
    flags: ["--limit", "--draft-top", "--tone", "--dry-run", "--queue", "--dir"],
  },
  {
    name: "watch",
    desc: "Live terminal dashboard that polls and refreshes ticket metrics",
    usage: "cliaas watch [--interval 5] [--status open]",
    flags: ["--interval", "--status", "--dir"],
  },
  {
    name: "stats",
    desc: "Show queue metrics with visual bar charts",
    usage: "cliaas stats [--dir ./exports/zendesk]",
    flags: ["--dir"],
  },
  {
    name: "duplicates",
    desc: "Detect potential duplicate tickets using subject similarity",
    usage: "cliaas duplicates [--threshold 70]",
    flags: ["--threshold", "--status", "--limit", "--dir"],
  },
  {
    name: "sla",
    desc: "SLA compliance monitor with breach and at-risk alerts",
    usage: "cliaas sla [--status open,pending]",
    flags: ["--status", "--dir"],
  },
  {
    name: "sentiment",
    desc: "LLM-powered customer sentiment analysis across ticket threads",
    usage: "cliaas sentiment [--status open] [--limit 10]",
    flags: ["--status", "--limit", "--dir"],
  },
  {
    name: "batch assign/tag/close",
    desc: "Bulk operations on multiple tickets",
    usage: "cliaas batch assign --agent <name> [--status open] [--priority urgent]",
    flags: ["--agent", "--status", "--priority", "--tag", "--limit", "--dir"],
  },
  {
    name: "export csv/markdown",
    desc: "Export tickets to CSV or Markdown report",
    usage: "cliaas export csv [--out tickets.csv] [--include-messages]",
    flags: ["--out", "--include-messages", "--status", "--limit", "--dir"],
  },
  {
    name: "demo",
    desc: "Generate realistic sample data for testing (no API keys needed)",
    usage: "cliaas demo [--tickets 50] [--out ./exports/demo]",
    flags: ["--tickets", "--out"],
  },
  {
    name: "config",
    desc: "Manage LLM provider configuration",
    usage: "cliaas config show | set-provider | set-key | set-openclaw",
    flags: [],
  },
];

const apiEndpoints = [
  {
    method: "GET",
    path: "/api/health",
    desc: "Service healthcheck",
    response: '{ "service": "cliaas", "status": "ok", "timestamp": "..." }',
  },
  {
    method: "GET",
    path: "/api/tickets",
    desc: "List tickets with filtering and pagination",
    params: "?status=open&priority=high&assignee=sarah&q=billing&sort=priority&limit=50&offset=0",
    response: '{ "tickets": [...], "total": 50, "limit": 50, "offset": 0 }',
  },
  {
    method: "GET",
    path: "/api/tickets/stats",
    desc: "Ticket queue statistics",
    response: '{ "total": 50, "byStatus": {...}, "byPriority": {...}, "byAssignee": {...}, "topTags": [...], "recentTickets": [...] }',
  },
  {
    method: "GET",
    path: "/api/tickets/[id]",
    desc: "Single ticket with conversation messages",
    response: '{ "ticket": {...}, "messages": [...] }',
  },
  {
    method: "GET",
    path: "/api/connectors",
    desc: "Available connector specifications",
    response: '{ "connectors": [...] }',
  },
];

export default function DocsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Documentation</span>
        </nav>
        <h1 className="text-3xl font-bold">CLIaaS Documentation</h1>
        <p className="mt-2 text-lg font-medium text-zinc-600">
          {cliCommands.length} CLI commands and {apiEndpoints.length} API
          endpoints.
        </p>
      </header>

      {/* CLI COMMANDS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-6">
          <h2 className="text-2xl font-bold">CLI Commands</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Install:{" "}
            <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
              npm install -g cliaas
            </code>{" "}
            or run with{" "}
            <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
              pnpm cliaas
            </code>
          </p>
        </div>
        <div className="divide-y divide-zinc-200">
          {cliCommands.map((cmd) => (
            <div key={cmd.name} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <code className="font-mono text-sm font-bold text-zinc-950">
                    cliaas {cmd.name}
                  </code>
                  <p className="mt-1 text-sm text-zinc-600">{cmd.desc}</p>
                </div>
              </div>
              <code className="mt-3 block bg-zinc-950 p-3 font-mono text-xs text-emerald-400">
                {cmd.usage}
              </code>
              {cmd.flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {cmd.flags.map((f) => (
                    <span
                      key={f}
                      className="border border-zinc-300 px-2 py-0.5 font-mono text-xs text-zinc-500"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* API ENDPOINTS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-6">
          <h2 className="text-2xl font-bold">API Endpoints</h2>
          <p className="mt-1 text-sm text-zinc-600">
            REST API served by the Next.js App Router. Base URL:{" "}
            <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
              https://cliaas.com
            </code>
          </p>
        </div>
        <div className="divide-y divide-zinc-200">
          {apiEndpoints.map((ep) => (
            <div key={ep.path} className="p-5">
              <div className="flex items-center gap-3">
                <span className="bg-emerald-100 px-2 py-0.5 font-mono text-xs font-bold text-emerald-800">
                  {ep.method}
                </span>
                <code className="font-mono text-sm font-bold">{ep.path}</code>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{ep.desc}</p>
              {"params" in ep && ep.params && (
                <code className="mt-2 block bg-zinc-100 p-2 font-mono text-xs text-zinc-600">
                  {ep.params}
                </code>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer font-mono text-xs text-zinc-500 hover:text-zinc-950">
                  Response shape
                </summary>
                <code className="mt-1 block bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
                  {ep.response}
                </code>
              </details>
            </div>
          ))}
        </div>
      </section>

      {/* QUICK START */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">Quick Start</h2>
        <pre className="mt-6 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-zinc-500"># Generate demo data (no API keys needed)</span>{"\n"}
          <span className="text-emerald-400">cliaas demo --tickets 50</span>{"\n\n"}
          <span className="text-zinc-500"># Browse your tickets</span>{"\n"}
          <span className="text-emerald-400">cliaas tickets list --status open</span>{"\n"}
          <span className="text-emerald-400">cliaas stats</span>{"\n"}
          <span className="text-emerald-400">cliaas duplicates</span>{"\n"}
          <span className="text-emerald-400">cliaas sla</span>{"\n\n"}
          <span className="text-zinc-500"># Configure LLM and run AI workflows</span>{"\n"}
          <span className="text-emerald-400">cliaas config set-provider claude</span>{"\n"}
          <span className="text-emerald-400">cliaas config set-key claude sk-ant-...</span>{"\n"}
          <span className="text-emerald-400">cliaas triage --limit 10</span>{"\n"}
          <span className="text-emerald-400">cliaas draft reply --ticket demo-4500</span>{"\n"}
          <span className="text-emerald-400">cliaas pipeline --dry-run</span>
        </pre>
      </section>
    </main>
  );
}
