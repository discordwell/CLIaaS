# CLIaaS

**Command-line native helpdesk platform.** CLIaaS (`cliaas.com`) is an AI-native customer support suite designed so that AI agents — Claude Code, or any MCP client — can read, triage, and act on support tickets as first-class operators, without locking you into proprietary AI features or workflows. Bring your own AI, your own processes, and (if you want) your own infrastructure. We provide the rails.

**Live:** https://cliaas.com · **Repo:** https://github.com/discordwell/CLIaaS · **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)

## Three Surfaces, One Platform

| Surface | What you get |
|---------|--------------|
| **Web app** | Full helpdesk UI — ticket inbox, customers, knowledge base, analytics, automation, WFM, QA, compliance, billing (90+ pages, 380+ API routes) |
| **CLI** (`cliaas`) | 50+ command groups: tickets, triage, drafting, migrations, sync, RAG, sandbox, reports, compliance |
| **MCP server** | 200+ tools, 6 resources, 4 workflow prompts over stdio — point any MCP client at your helpdesk |

## Feature Highlights

- **AI agent pipeline** — auto-triage, draft replies, AI resolution queue with approval workflow, hallucination guard (KB-citation enforcement), per-channel policies, procedures, circuit breaker
- **Omnichannel** — email, chat widget, SMS/WhatsApp/Voice (Twilio), Facebook/Instagram, Twitter/X, Telegram, Slack, MS Teams, mobile SDK
- **10 helpdesk connectors** — Zendesk, Freshdesk, Groove, HelpCrunch, Kayako (modern + classic), Intercom, Help Scout, Zoho Desk, HubSpot: one-shot migration *and* continuous bidirectional sync
- **Engineering & CRM integrations** — Jira Cloud, Linear, Salesforce, HubSpot CRM, plus a user-definable custom objects engine
- **Enterprise-grade** — RBAC (35 permissions, custom roles), SSO (SAML/OIDC + JIT), SCIM, MFA, row-level security, audit trails, GDPR/HIPAA tooling, PII detection & masking, SOC 2 dashboard
- **Automation** — rules, triggers, macros, SLA policies with business-hours math, visual workflow & chatbot builders, plugin marketplace with sandboxed execution
- **Analytics & WFM** — custom report builder, live dashboards (SSE), CSAT/NPS/CES surveys, forecasting, schedule optimization, adherence tracking

## Product Tiers

- **BYOC (free, self-hosted)** — clone the repo, run the `WIZARD/` setup, sync from your existing helpdesk, run the MCP server against your own Postgres. If CLIaaS disappears, nothing breaks.
- **Hosted** — full GUI and premium features on our infrastructure.
- **Hybrid** — hosted source of truth with a local syncing replica; explicit push-upstream with conflict detection. Survives outages.

The MCP server is tier-agnostic: same tools, same interface, different backend. Start BYOC, upgrade to hosted — your AI workflows don't change.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4
- PostgreSQL via Drizzle ORM (150+ tables, RLS-enforced, pgvector for RAG) — **or no database at all**: every store falls back to JSONL files for demo/BYOC-lite mode
- BullMQ + Redis job queues (optional — graceful inline fallback)
- LLM providers: Anthropic Claude, OpenAI, or any custom endpoint
- Observability: Sentry, Prometheus `/api/metrics`, Pino structured logging

## Local Development

```bash
pnpm install
pnpm dev            # web app on :3000, JSONL demo mode — no DB required
```

With a database (Docker):

```bash
pnpm db:setup       # compose up Postgres+Redis, migrate, seed
```

CLI and MCP server:

```bash
pnpm cliaas -- --help          # run the CLI
pnpm cliaas -- mcp install     # register the MCP server with Claude Code
pnpm mcp:dev                   # run the MCP server directly (stdio)
```

## Quality Checks

```bash
pnpm check          # lint + typecheck + build
pnpm test           # vitest suite
pnpm test:db        # database integration tests (needs Docker Postgres)
pnpm test:qa        # Playwright end-to-end
```

## Repository Layout

```
src/app/        Next.js pages + API routes
src/lib/        Business logic (shared by web, CLI, and MCP)
src/db/         Drizzle schema + SQL migrations
cli/            CLI commands, connectors, LLM providers, RAG, sync engine
cli/mcp/        MCP server (tools, resources, prompts)
sdk/            Embeddable mobile/web SDK (@cliaas/sdk)
WIZARD/         BYOC guided-setup harness
deploy/         systemd + nginx configs
docs/           Additional documentation
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and [AGENTS.md](AGENTS.md) for the MCP tool catalog and agent workflow recipes.

## Deploy To VPS (`cliaas.com`)

1. Ensure SSH access to your server.
2. Ensure remote host has Node.js 20+ and `pnpm` (or `corepack`) installed.
3. Set deploy vars and run:

```bash
VPS_HOST=cliaas.com VPS_USER=root bash scripts/deploy_vps.sh
```

Optional overrides:

- `REMOTE_DIR` (default `/opt/cliaas`)
- `SERVICE_NAME` (default `cliaas`)
- `APP_PORT` (default `3101`)
- `SKIP_NGINX=1` to skip nginx config step

Deployment installs:

- `deploy/cliaas.service` -> systemd unit
- `deploy/nginx.cliaas.com.conf` -> nginx reverse proxy
