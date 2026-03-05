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

CLIaaS exposes 60 MCP tools, 6 resources, and 4 prompts for AI-powered helpdesk management.

## Quick Start

```bash
# Install globally
npm install -g cliaas

# Initialize in any project (writes .mcp.json + agent instructions + demo data)
cliaas init

# Verify MCP server
cliaas mcp test
```

Or for full BYOC setup: `cliaas setup`

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

### Write Actions (7 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `ticket_update` | Update ticket fields | ticketId, status?, priority?, assignee?, confirm=true |
| `ticket_reply` | Send reply to ticket | ticketId, body, confirm=true |
| `ticket_note` | Add internal note | ticketId, body, confirm=true |
| `ticket_create` | Create new ticket | subject, description?, priority?, confirm=true |
| `ai_resolve` | AI resolution for ticket | ticketId, confirm=true |
| `rule_create` | Create automation rule | name, type, conditions?, actions?, confirm=true |
| `rule_toggle` | Enable/disable rule | ruleId, enabled, confirm=true |

### Sync (8 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `sync_trigger` | Trigger sync for connector | connector, fullSync? |
| `sync_status` | Check sync status | connector? |
| `sync_pull` | Pull from hosted to local | (none) |
| `sync_push` | Push local changes to hosted | (none) |
| `sync_conflicts` | List sync conflicts | (none) |
| `upstream_push` | Push changes to source platform | connector? |
| `upstream_status` | Upstream push status | connector? |
| `upstream_retry` | Retry failed upstream pushes | connector? |

### Surveys (3 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `survey_config` | Configure CSAT surveys | type, trigger, enabled? |
| `survey_send` | Send survey to customer | ticketId, confirm=true |
| `survey_stats` | Survey response statistics | period? |

### Chatbots (4 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `chatbot_list` | List chatbots | (none) |
| `chatbot_create` | Create chatbot | name, flow, confirm=true |
| `chatbot_toggle` | Enable/disable chatbot | chatbotId, enabled, confirm=true |
| `chatbot_delete` | Delete chatbot | chatbotId, confirm=true |

### Workflows (6 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `workflow_list` | List workflows | (none) |
| `workflow_get` | Get workflow details | workflowId |
| `workflow_create` | Create workflow | name, nodes, transitions, confirm=true |
| `workflow_toggle` | Enable/disable workflow | workflowId, enabled, confirm=true |
| `workflow_delete` | Delete workflow | workflowId, confirm=true |
| `workflow_export` | Export workflow definition | workflowId |

### Customers (4 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `customer_list` | List customers | limit?, offset? |
| `customer_show` | Show customer details + timeline | customerId |
| `customer_search` | Search customers | query |
| `customer_merge` | Merge duplicate customers | sourceId, targetId, confirm=true |

### Time Tracking (2 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `time_report` | Time tracking report | period?, groupBy? |
| `time_log` | Log time on ticket | ticketId, minutes, billable?, confirm=true |

### Forums (3 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `forum_categories` | List forum categories | (none) |
| `forum_threads` | List threads in category | categoryId, limit? |
| `forum_thread_to_ticket` | Convert thread to ticket | threadId, confirm=true |

### QA (2 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `qa_reviews` | List QA reviews | period?, agent? |
| `qa_scorecard` | Get QA scorecard metrics | period? |

### Campaigns (3 tools)
| Tool | Description | Key Params |
|------|-------------|------------|
| `campaign_list` | List campaigns | status? |
| `campaign_create` | Create outbound campaign | name, template, recipients, confirm=true |
| `campaign_stats` | Campaign analytics | campaignId |

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
├── server.ts           # Entry point (stdio transport, `cliaas mcp serve`)
├── util.ts             # Safe wrappers, result helpers
├── tools/
│   ├── tickets.ts      # 3 tools: list, show, search
│   ├── analysis.ts     # 6 tools: triage, draft, sentiment, duplicates, summarize
│   ├── kb.ts           # 2 tools: search, suggest
│   ├── rag.ts          # 3 tools: search, ask, status
│   ├── queue.ts        # 2 tools: stats, sla
│   ├── config.ts       # 2 tools: show, set-provider
│   ├── actions.ts      # 7 tools: ticket CRUD, rules, ai_resolve
│   ├── sync.ts         # 8 tools: sync trigger/status/pull/push/conflicts, upstream
│   ├── surveys.ts      # 3 tools: config, send, stats
│   ├── chatbots.ts     # 4 tools: list, create, toggle, delete
│   ├── workflows.ts    # 6 tools: list, get, create, toggle, delete, export
│   ├── customers.ts    # 4 tools: list, show, search, merge
│   ├── time.ts         # 2 tools: report, log
│   ├── forums.ts       # 3 tools: categories, threads, thread_to_ticket
│   ├── qa.ts           # 2 tools: reviews, scorecard
│   └── campaigns.ts    # 3 tools: list, create, stats
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
