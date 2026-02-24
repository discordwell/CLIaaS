# CLIaaS MCP Agent Configuration

This document provides the complete MCP tool reference, workflow recipes, and environment configuration for AI agents operating against a CLIaaS BYOC instance.

## MCP Server Configuration

The MCP server runs via stdio transport. Configure in `.mcp.json`:

```json
{
  "mcpServers": {
    "cliaas": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "cli/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/cliaas",
        "CLIAAS_MODE": "local"
      }
    }
  }
}
```

## Complete Tool Catalog (27 Tools)

### Ticket Management (3 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `tickets_list` | List tickets with optional filters | `status?` (open/pending/on_hold/solved/closed), `priority?` (low/normal/high/urgent), `assignee?` (partial match), `tag?` (partial match), `limit` (default: 25), `dir?` |
| `tickets_show` | Show a single ticket with full conversation thread | `ticketId` (required), `dir?` |
| `tickets_search` | Full-text search across tickets and messages | `query` (required), `limit` (default: 20), `dir?` |

### AI Analysis (6 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `triage_ticket` | LLM-powered triage: suggests priority, category, assignee | `ticketId` (required), `dir?` |
| `triage_batch` | Batch triage multiple tickets by status | `status` (default: open), `limit` (default: 10), `dir?` |
| `draft_reply` | AI-generated reply with optional RAG context | `ticketId` (required), `tone` (professional/concise/friendly/formal, default: professional), `useRag?` (boolean), `ragTopK` (default: 5), `dir?` |
| `sentiment_analyze` | Customer sentiment analysis via LLM | `ticketId?`, `status` (default: open), `limit` (default: 10), `dir?` |
| `detect_duplicates` | Find duplicate tickets by subject similarity | `threshold` (0-100, default: 70), `status?`, `limit` (default: 20), `dir?` |
| `summarize_queue` | AI-powered summary of the support queue | `period` (default: today), `dir?` |

### Knowledge Base (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `kb_search` | Text search across KB articles | `query` (required), `limit` (default: 10), `dir?` |
| `kb_suggest` | LLM-powered KB article suggestions for a ticket | `ticketId` (required), `top` (default: 3), `useRag?` (boolean), `dir?` |

### RAG / Semantic Search (3 tools)

Requires pgvector database (`RAG_DATABASE_URL` or `DATABASE_URL`).

| Tool | Description | Parameters |
|------|-------------|------------|
| `rag_search` | Semantic search over the vector store | `query` (required), `topK` (default: 5), `sourceType?` (kb_article/ticket_thread/external_file) |
| `rag_ask` | Ask a question and get a RAG-retrieved answer | `question` (required), `topK` (default: 5) |
| `rag_status` | Show vector store statistics (chunk counts) | (none) |

### Queue Metrics (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `queue_stats` | Ticket counts by status, priority, assignee, alerts | `dir?` |
| `sla_report` | SLA compliance report: breaches, at-risk, compliant | `status?` (comma-separated, default: open,pending), `dir?` |

### Configuration (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `config_show` | Show current CLIaaS config (API keys masked) | (none) |
| `config_set_provider` | Switch active LLM provider | `provider` (required: claude/openai/openclaw) |

### Write Actions (5 tools)

All write actions require `confirm: true` to execute.

| Tool | Description | Parameters |
|------|-------------|------------|
| `ticket_update` | Update ticket status, priority, assignee, tags | `ticketId` (required), `status?`, `priority?`, `assignee?`, `addTags?`, `removeTags?`, `confirm` (required: true) |
| `ticket_reply` | Send a reply to a ticket | `ticketId` (required), `body` (required), `confirm` (required: true) |
| `ticket_note` | Add an internal note to a ticket | `ticketId` (required), `body` (required), `confirm` (required: true) |
| `ticket_create` | Create a new ticket | `subject` (required), `description?`, `priority?`, `requester?`, `tags?`, `confirm` (required: true) |
| `ai_resolve` | Trigger AI resolution for a ticket | `ticketId` (required), `confirm` (required: true) |

### Automation (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `rule_create` | Create an automation rule | `name` (required), `type` (trigger/macro/automation/sla), `conditions?`, `actions?`, `confirm` (required: true) |
| `rule_toggle` | Enable or disable an automation rule | `ruleId` (required), `enabled` (required: boolean), `confirm` (required: true) |

### Sync (2 tools)

| Tool | Description | Parameters |
|------|-------------|------------|
| `sync_run` | Run a sync cycle for a connector | `connector` (required), `fullSync?` (boolean) |
| `sync_status` | Check sync status for connectors | `connector?` |

## Resources (6)

| URI | Description |
|-----|-------------|
| `cliaas://tickets` | Full ticket list as JSON |
| `cliaas://tickets/{id}` | Single ticket with conversation thread |
| `cliaas://kb-articles` | All KB articles |
| `cliaas://stats` | Queue statistics snapshot |
| `cliaas://rag/status` | RAG store chunk counts |
| `cliaas://config` | Current configuration (keys masked) |

## Prompts (4)

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `triage-workflow` | Load queue, triage, draft top-priority replies | `status?`, `limit?` |
| `draft-reply` | Show ticket, find KB, draft context-aware reply | `ticketId`, `tone?` |
| `shift-handoff` | Queue summary + SLA + sentiment for shift handoff | `period?` |
| `investigate-customer` | Search tickets, show threads, analyze customer history | `query` |

## Workflow Recipes

### Triage Incoming Tickets

```
1. queue_stats                        → Get queue overview
2. sla_report                         → Identify breaches / at-risk
3. triage_batch (status=open, limit=10) → AI-prioritize open tickets
4. For each urgent ticket:
   a. tickets_show                    → Read full thread
   b. kb_suggest (useRag=true)        → Find relevant KB articles
   c. draft_reply (tone=professional) → Generate response draft
5. ticket_update                      → Apply triage recommendations
```

### Draft Reply to Urgent Ticket

```
1. tickets_show (ticketId=<id>)       → Read the conversation
2. kb_suggest (ticketId=<id>, useRag=true) → Find relevant KB content
3. draft_reply (ticketId=<id>, useRag=true, tone=professional)
4. Review draft, then:
   ticket_reply (ticketId=<id>, body=<draft>, confirm=true)
```

### Weekly Queue Summary

```
1. summarize_queue (period=week)      → AI summary of the week
2. queue_stats                        → Volume metrics
3. sla_report                         → Compliance status
4. sentiment_analyze (limit=20)       → Customer mood overview
5. detect_duplicates                  → Cleanup opportunities
```

### KB Article Suggestions

```
1. tickets_show (ticketId=<id>)       → Understand the issue
2. kb_search (query=<keywords>)       → Text search KB
3. kb_suggest (ticketId=<id>, useRag=true) → Semantic KB matching
4. rag_ask (question=<customer question>) → RAG-powered answer
```

### Customer Investigation

```
1. tickets_search (query=<customer email or name>)
2. For each matching ticket:
   a. tickets_show (ticketId=<id>)
3. sentiment_analyze (ticketId=<id>)  → Per-ticket sentiment
4. detect_duplicates                  → Find related issues
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

### LLM Provider (at least one required for AI tools)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `OPENAI_API_KEY` | OpenAI API key |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIAAS_MODE` | auto-detected | Force mode: local, db, remote, hybrid |
| `CLIAAS_DATA_DIR` | `./exports` | JSONL export directory |
| `RAG_DATABASE_URL` | (uses DATABASE_URL) | Separate pgvector database |
| `REDIS_URL` | (none) | Redis for BullMQ job queues |
| `LOG_LEVEL` | info | Pino log level |

### Connector Credentials

Each connector has its own env vars. See `.env.example` for the full list. Common ones:

| Connector | Variables |
|-----------|-----------|
| Zendesk | `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_TOKEN` |
| Kayako | `KAYAKO_DOMAIN`, `KAYAKO_EMAIL`, `KAYAKO_PASSWORD` |
| Freshdesk | `FRESHDESK_DOMAIN`, `FRESHDESK_API_KEY` |
| Intercom | `INTERCOM_TOKEN` |
| Help Scout | `HELPSCOUT_APP_ID`, `HELPSCOUT_APP_SECRET` |
| HubSpot | `HUBSPOT_TOKEN` |
