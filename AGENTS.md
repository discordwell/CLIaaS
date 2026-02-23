# AGENTS.md

## Domain Topology
- Primary domain: `https://cliaas.com` (including `https://www.cliaas.com`)
- Primary domain code location: `/Users/discordwell/Projects/Zachathon`
- Canonical repository: `https://github.com/discordwell/CLIaaS`
- Infrastructure note: deployed to a VPS via `scripts/deploy_vps.sh`, with systemd + nginx config from `deploy/`.

## Guardrails
- Keep framework as Next.js App Router.
- Prioritize clean deploy path to a public URL.
- Ignore any code in the EasterEgg folder unless you are specifically tasked with developing it.

---

# CLIaaS MCP Agent Guide

CLIaaS exposes 18 MCP tools, 6 resources, and 4 prompts for AI-powered helpdesk management.

## Quick Start

```bash
# Generate demo data (if no exports exist)
pnpm cliaas demo

# Install MCP config for Claude Code auto-discovery
pnpm cliaas mcp install

# Verify server starts and lists all tools
pnpm cliaas mcp test
```

Or use the guided setup: `pnpm cliaas mcp setup`

## Tool Catalog

### Tickets (3 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `tickets_list` | List tickets with filters | status?, priority?, assignee?, tag?, limit=25, dir? |
| `tickets_show` | Show ticket + full conversation thread | ticketId, dir? |
| `tickets_search` | Full-text search across tickets and messages | query, limit=20, dir? |

### Analysis (6 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `triage_ticket` | AI triage: priority, category, assignee suggestion | ticketId, dir? |
| `triage_batch` | Batch triage multiple tickets | status=open, limit=10, dir? |
| `draft_reply` | AI-generated reply with optional RAG context | ticketId, tone=professional, useRag?, ragTopK=5, dir? |
| `sentiment_analyze` | Customer sentiment analysis via LLM | ticketId?, status=open, limit=10, dir? |
| `detect_duplicates` | Find duplicate tickets by subject similarity | threshold=70, status?, limit=20, dir? |
| `summarize_queue` | AI-powered queue summary | period=today, dir? |

### Knowledge Base (2 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `kb_search` | Text search across KB articles | query, limit=10, dir? |
| `kb_suggest` | LLM-powered KB suggestions for a ticket | ticketId, top=3, useRag?, dir? |

### RAG (3 tools) — requires pgvector database
| Tool | Description | Key Params |
|------|-------------|------------|
| `rag_search` | Semantic search over the vector store | query, topK=5, sourceType? |
| `rag_ask` | Ask a question with RAG-retrieved context | question, topK=5 |
| `rag_status` | Show RAG store statistics | (none) |

### Queue (2 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `queue_stats` | Queue metrics: by status, priority, assignee | dir? |
| `sla_report` | SLA compliance: breaches, at-risk, compliant | status?, dir? |

### Config (2 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `config_show` | Show current config (keys masked) | (none) |
| `config_set_provider` | Switch LLM provider | provider: claude\|openai\|openclaw |

## Resources (6)
| URI | Description |
|-----|-------------|
| `cliaas://tickets` | Full ticket list JSON |
| `cliaas://tickets/{id}` | Single ticket + conversation thread |
| `cliaas://kb-articles` | All KB articles |
| `cliaas://stats` | Queue statistics snapshot |
| `cliaas://rag/status` | RAG store chunk counts |
| `cliaas://config` | Current config (keys masked) |

## Prompts (4)
| Prompt | Description | Args |
|--------|-------------|------|
| `triage-workflow` | Load queue, triage, draft top-priority replies | status?, limit? |
| `draft-reply` | Show ticket, find KB, draft context-aware reply | ticketId, tone? |
| `shift-handoff` | Queue summary + SLA + sentiment for handoff | period? |
| `investigate-customer` | Search tickets, show threads, analyze history | query |

## Domain Model

### Ticket
- **Statuses**: open, pending, on_hold, solved, closed
- **Priorities**: low, normal, high, urgent
- **Sources**: zendesk, kayako, kayako-classic, helpcrunch, freshdesk, groove, intercom, helpscout, zoho-desk, hubspot
- **Fields**: id, externalId, subject, status, priority, assignee, requester, tags, createdAt, updatedAt

### Message
- **Types**: reply, note, system
- **Fields**: id, ticketId, author, body, type, createdAt

### KBArticle
- **Fields**: id, externalId, title, body, categoryPath

## Data Modes

### JSONL File Mode (no database needed)
All ticket/message/KB tools work with JSONL files in `./exports/`. Generate demo data:
```bash
pnpm cliaas demo
```

### Postgres Mode (full features + RAG)
Set `DATABASE_URL` and/or `RAG_DATABASE_URL` for RAG features:
```bash
# Self-hosted
docker compose up -d
pnpm cliaas rag init
pnpm cliaas rag import source --type kb
pnpm cliaas rag import source --type tickets
```

## Workflow Recipes

### Morning Triage
1. `queue_stats` — overview of queue volume
2. `sla_report` — check for breaches
3. `triage_batch` with status=open — AI-powered prioritization
4. `draft_reply` for urgent tickets — prepare responses

### Customer Investigation
1. `tickets_search` with customer name/email
2. `tickets_show` for each relevant ticket
3. `sentiment_analyze` on the customer's tickets
4. `detect_duplicates` to find related issues

### KB-Augmented Reply
1. `tickets_show` — read the full conversation
2. `kb_suggest` with useRag=true — find relevant articles
3. `draft_reply` with useRag=true — generate context-aware draft

### Shift Handoff
1. `summarize_queue` — AI summary of queue state
2. `sla_report` — compliance status
3. `sentiment_analyze` — frustrated customers
4. Compile into handoff notes

### Duplicate Cleanup
1. `detect_duplicates` with threshold=70
2. `tickets_show` for each group to verify
3. Tag or merge as appropriate

## Error Patterns

| Error | Meaning | Fix |
|-------|---------|-----|
| "No ticket data found" | No JSONL export files | Run `cliaas demo` or export from a connector |
| "No RAG database configured" | RAG_DATABASE_URL and DATABASE_URL both unset | Set env var or run `docker compose up -d` |
| "No Claude/OpenAI API key" | LLM provider not configured | Set ANTHROPIC_API_KEY or OPENAI_API_KEY |
| "RAG not initialized" | pgvector tables not created | Run `cliaas rag init` |
| Tool returns `isError: true` | Tool-specific failure | Check the error message for details |

## Architecture

```
cli/mcp/
├── server.ts           # Entry point (stdio transport)
├── util.ts             # Safe wrappers, result helpers
├── tools/
│   ├── tickets.ts      # 3 tools: list, show, search
│   ├── analysis.ts     # 6 tools: triage, draft, sentiment, duplicates, summarize
│   ├── kb.ts           # 2 tools: search, suggest
│   ├── rag.ts          # 3 tools: search, ask, status
│   ├── queue.ts        # 2 tools: stats, sla
│   └── config.ts       # 2 tools: show, set-provider
├── resources/
│   └── index.ts        # 6 resources
└── prompts/
    └── index.ts        # 4 prompts
```

The MCP server reuses existing CLI infrastructure:
- `cli/data.ts` — JSONL file loading
- `cli/providers/` — LLM provider abstraction (Claude, OpenAI, OpenClaw)
- `cli/rag/` — pgvector retrieval pipeline
- `cli/config.ts` — config management
