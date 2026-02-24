# CLIaaS BYOC Setup Guide

You are helping the user set up CLIaaS in BYOC (Bring Your Own Cloud) mode. This is the free, self-hosted tier where the customer owns all data and infrastructure.

## What is CLIaaS?

CLIaaS (CLI-as-a-Service) is an enterprise helpdesk platform with a CLI-first design. It lets support teams export data from helpdesks (Zendesk, Kayako, Freshdesk, etc.) and run AI-powered operations: triage, drafts, sentiment analysis, duplicate detection, and queue summaries.

**BYOC mode** means:
- All data stays on the user's machine or server
- PostgreSQL database is self-managed
- The user provides their own LLM API key
- Full feature access (analytics, AI dashboard, automation, SLA, compliance, SSO, branding)
- MCP tools work with the local database

## Prerequisites

Before starting, ensure:
1. **Node.js 18+** — `node -v` should show v18 or later
2. **pnpm** — Install via `corepack enable && corepack prepare pnpm@latest --activate`
3. **PostgreSQL** — Either local install or Docker (`docker compose up -d`)
4. **git** — For cloning the repo
5. **LLM API key** — Anthropic (Claude) or OpenAI key for AI features

## Setup Steps

### 1. Clone and Install

```bash
git clone https://github.com/discordwell/CLIaaS.git
cd CLIaaS
bash scripts/install-byoc.sh
```

The install script will prompt for:
- PostgreSQL connection URL
- LLM provider and API key
- Optional connector for initial data sync

### 2. Manual Setup (Alternative)

If you prefer manual setup:

```bash
# Install dependencies
pnpm install

# Copy env template and edit
cp .env.example .env
# Edit .env: set DATABASE_URL, ANTHROPIC_API_KEY or OPENAI_API_KEY

# Run migrations
pnpm drizzle-kit push

# Generate demo data (optional)
pnpm cliaas demo

# Start the web dashboard
pnpm dev
```

### 3. Connector Configuration

To import data from an existing helpdesk:

**Zendesk:**
```bash
# Set in .env:
ZENDESK_SUBDOMAIN=yourcompany
ZENDESK_EMAIL=admin@yourcompany.com
ZENDESK_TOKEN=your-api-token

# Run sync
pnpm cliaas sync run --connector zendesk
```

**Kayako:**
```bash
KAYAKO_DOMAIN=yourcompany.kayako.com
KAYAKO_EMAIL=admin@yourcompany.com
KAYAKO_PASSWORD=your-password
```

**Freshdesk:**
```bash
FRESHDESK_DOMAIN=yourcompany.freshdesk.com
FRESHDESK_API_KEY=your-api-key
```

Supported connectors: zendesk, kayako, kayako-classic, freshdesk, helpcrunch, groove, intercom, helpscout, zoho-desk, hubspot.

### 4. MCP Setup

MCP (Model Context Protocol) lets AI agents use CLIaaS tools directly:

```bash
# Test the MCP server
pnpm cliaas mcp test

# Install for Claude Code auto-discovery
pnpm cliaas mcp install
```

The `.mcp.json` file in the project root configures the MCP server. After install, AI agents can use all 27 tools (ticket management, AI analysis, KB search, RAG, queue metrics).

### 5. Web Dashboard

```bash
pnpm dev
# Visit http://localhost:3000/setup for guided web setup
# Or http://localhost:3000/dashboard for the main dashboard
```

## After Setup

Common first tasks:
- `pnpm cliaas demo` — Generate sample data to explore features
- `pnpm cliaas triage --limit 5` — AI-powered ticket triage
- `pnpm cliaas queue stats` — View queue metrics
- `pnpm cliaas draft reply --ticket <id>` — Draft an AI response
- `pnpm cliaas sync status` — Check connector sync status

## Troubleshooting

See `WIZARD/TROUBLESHOOTING.md` for common issues. Key checks:
- Postgres running? `pg_isready -h localhost -p 5432`
- Env vars loaded? `cat .env | grep DATABASE_URL`
- Migrations applied? `pnpm drizzle-kit push`
- MCP working? `pnpm cliaas mcp test`

## Architecture Notes

- **DataProvider pattern**: All data access goes through `src/lib/data-provider/`. In BYOC mode with a database, it uses `DbProvider`. Without a database, it falls back to `JsonlProvider` (file-based).
- **Feature gating**: BYOC tier gets full access to all features (see `src/lib/features/gates.ts`).
- **Sync engine**: `cli/sync/engine.ts` handles incremental and full syncs from connectors.
- **Config**: CLI config lives at `~/.cliaas/config.json`. App config is in `.env`.
