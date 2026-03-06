# CLIaaS Architecture

> Command-Line Native SaaS — an enterprise helpdesk platform with CLI-first design, AI triage, and 10+ connector integrations.

**Live:** https://cliaas.com | **Repo:** github.com/discordwell/CLIaaS

## Project Stats

| Metric | Value |
|--------|-------|
| Pages | 41 (Next.js App Router) |
| API Routes | 176 |
| Components | 15 shared React components |
| Library modules | 71 (`src/lib/`) |
| CLI files | 81 (`cli/`) |
| CLI commands | 40 registered command groups |
| Connectors | 10 helpdesk integrations |
| MCP tools | 80 (across 17 modules) |
| MCP resources | 6 |
| MCP prompts | 4 workflow prompts |
| DB tables | 76 (Drizzle/PostgreSQL, RLS-enabled) |
| Tests | 91 files, ~7,700 LOC |
| Source LOC | ~57,000 (excl. Easter Egg + tests) |
| Dependencies | 24 prod + 19 dev |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                               │
│  Browser (PWA)  │  CLI (cliaas)  │  MCP (AI agents)         │
└────────┬────────┴───────┬────────┴──────────┬───────────────┘
         │                │                   │
         ▼                ▼                   ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  Next.js App    │ │  Commander   │ │  MCP Server      │
│  38 pages       │ │  37 commands │ │  60 tools        │
│  148 API routes │ │  10 connect. │ │  6 resources     │
│                 │ │  3 providers │ │  4 prompts       │
└────────┬────────┘ └──────┬───────┘ └────────┬─────────┘
         │                 │                   │
         ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic (src/lib/)                  │
│                                                              │
│  Tickets │ Webhooks │ Plugins │ SSE │ Channels │ Auth        │
│  SLA     │ CSAT     │ KB      │ AI  │ Sandbox  │ Audit      │
│  Events  │ Push     │ SOC2    │ SSO │ Realtime │ Security   │
│  Billing │ Queue    │ Metrics │     │          │            │
└────────┬──────────────────┬──────────────────┬──────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  PostgreSQL     │ │  JSONL Files │ │  External APIs   │
│  73 tables      │ │  (demo mode) │ │  Twilio, Meta,   │
│  pgvector RAG   │ │  /cliaas-data│ │  Twitter, SMTP   │
└─────────────────┘ └──────────────┘ └──────────────────┘
```

---

## Persistence: Dual-Mode Design

CLIaaS operates in two persistence modes:

### JSONL File Mode (no database required)
- All data stored as newline-delimited JSON in `CLIAAS_DATA_DIR` (default: `/tmp/cliaas-demo`)
- Global singleton stores survive Next.js HMR via `global.__cliaa*` pattern
- Files: `tickets.jsonl`, `messages.jsonl`, `automation-rules.jsonl`, `kb-articles.jsonl`, `sla-policies.jsonl`, `custom-fields.jsonl`, `webhooks.jsonl`, `plugins.jsonl`, `push-subscriptions.jsonl`
- Used for: demos, CLI operations, development

### PostgreSQL Mode (full features)
- 53 tables via Drizzle ORM (`src/db/schema.ts`)
- Multi-tenant: `tenants` → `workspaces` → all domain tables
- pgvector extension for RAG embeddings (`vector(1536)`)
- Connection pool: singleton via `global.__cliaasPool` (dev) or `new Pool` (prod)
- Lazy proxy: `db` and `pool` exports throw only when operations attempted without `DATABASE_URL`

### Store Modules (JSONL)

Each domain has a dedicated store in `src/lib/`:

| Store | File | Singleton Global |
|-------|------|-----------------|
| Tickets | `jsonl-store.ts` | Generic `JsonlStore<T>` class |
| Webhooks | `webhooks.ts` | `global.__cliaaWebhooks` |
| Plugins | `plugins.ts` | `global.__cliaaPlugins` |
| SLA | `sla.ts` | `global.__cliaaSLA` |
| CSAT | `csat.ts` | `global.__cliaaCsat` |
| Custom Fields | `custom-fields.ts` | `global.__cliaaCustomFields` |
| Push Subs | `push.ts` | `global.__cliaaPushSubs` |
| Voice Calls | `channels/voice-store.ts` | `global.__cliaaVoiceCalls` |
| SMS Messages | `channels/sms-store.ts` | `global.__cliaaSmsMessages` |
| Customer Activities | `customers/customer-store.ts` | Module-level arrays |
| Customer Notes | `customers/customer-store.ts` | Module-level arrays |
| Customer Segments | `customers/customer-store.ts` | Module-level arrays |
| Forum Categories | `forums/forum-store.ts` | Module-level arrays |
| Forum Threads | `forums/forum-store.ts` | Module-level arrays |
| Forum Replies | `forums/forum-store.ts` | Module-level arrays |
| QA Scorecards | `qa/qa-store.ts` | Module-level arrays |
| QA Reviews | `qa/qa-store.ts` | Module-level arrays |
| Campaigns | `campaigns/campaign-store.ts` | Module-level arrays |
| Campaign Recipients | `campaigns/campaign-store.ts` | Module-level arrays |
| Slack Mappings | `channels/slack-intake.ts` | `global.__cliaasSlackMappings` |
| Slack Conversations | `channels/slack-intake.ts` | `global.__cliaasSlackConvs` |
| Telegram Configs | `channels/telegram-store.ts` | Module-level arrays |
| SDK Sessions | `channels/sdk-session.ts` | Module-level Map |
| Canned Responses | `canned/canned-store.ts` | Module-level arrays |
| Macros | `canned/macro-store.ts` | Module-level arrays |
| Agent Signatures | `canned/signature-store.ts` | Module-level arrays |

---

## Database Schema (76 tables)

### Core Multi-Tenancy (3)
`tenants` → `workspaces` → `users`

### Tickets & Conversations (5 + 2)
`tickets` → `conversations` (primary/side, with subject, external_email, status) → `messages` (with visibility, mentioned_user_ids) → `attachments`, `groups`

### Notifications & Mentions (2)
`notifications` (per-user, type=mention/side_conversation_reply/assignment/escalation, resource linking), `mentions` (message-level @mention tracking with read state)

### Customers (6)
`customers` (+10 enrichment columns), `organizations`, `customer_activities`, `customer_notes`, `customer_segments`, `customer_merge_log`

### Channels (4)
`inboxes` (email, chat, api, sms, phone, web, whatsapp, facebook, instagram, twitter, slack, teams, telegram, sdk), `telegram_bot_configs`, `slack_channel_mappings`, `teams_channel_mappings`

### Configuration (4)
`brands`, `ticket_forms`, `custom_fields`, `custom_field_values`

### Rules & Automation (3)
`rules` (macros, triggers, automations, SLA), `automation_rules`, `sla_policies`

### Canned Responses & Macros (3)
`canned_responses` (reusable reply templates with merge variables, categories, shortcuts), `macros` (native one-click multi-action bundles with structured actions JSONB), `agent_signatures` (per-agent HTML/text email signatures with default flag)

### SLA Tracking (1)
`sla_events` (breach detection). SLA policies support `businessHoursId` for schedule-aware elapsed time calculation.

### Business Hours & Holidays (3)
`holiday_calendars` (named collections of holidays with descriptions), `holiday_entries` (individual dates with recurring/partial-day support), `business_hours_holiday_links` (M2M join linking schedules to calendars). Holiday presets available: US Federal, UK Bank, Canada Statutory, Australia Public. Core engine in `src/lib/wfm/business-hours.ts` provides `addBusinessMinutes()`, `getElapsedBusinessMinutes()`, `isWithinBusinessHours()`, `nextBusinessHourStart/Close()`. UI at `/business-hours` with weekly grid editor + holiday calendar management.

### Views & Tags (3)
`views` (saved ticket filters with query JSONB, view_type: system/shared/personal, position ordering, user ownership), `tags` (workspace-scoped with color + description), `ticket_tags` (many-to-many junction, synced to tickets.tags array)

### CSAT & Time (2)
`csat_ratings`, `time_entries` (+billable, customerId, groupId columns)

### Surveys — CSAT/NPS/CES (2)
`survey_responses` (unified survey responses with `survey_type` discriminator: csat/nps/ces, token-based portal access), `survey_configs` (per-workspace survey settings: enable/disable, trigger event, delay, custom question text; unique on workspace+surveyType)

### Knowledge Base (4)
`kb_collections` → `kb_categories` → `kb_articles` → `kb_revisions`

### Integration & Sync (6)
`integrations`, `external_objects` (ID mapping), `sync_cursors`, `raw_records`, `sync_outbox` (hybrid push queue), `sync_conflicts` (conflict tracking)

### Jobs (2)
`import_jobs`, `export_jobs`

### SSO (1)
`sso_providers` (SAML + OIDC)

### Audit (2)
`audit_events`, `audit_entries`

### RAG (2)
`rag_chunks` (vector(1536)), `rag_import_jobs`

### Billing (2)
`usage_metrics` (tenant per-period usage counters), `billing_events` (Stripe webhook audit log)

### Community Forums (3)
`forum_categories`, `forum_threads`, `forum_replies`

### QA / Conversation Review (2)
`qa_scorecards` (criteria JSONB), `qa_reviews` (scores JSONB)

### Proactive Messaging (2)
`campaigns`, `campaign_recipients`

### Key Indexes
- `tickets_workspace_status_idx` — queue queries
- `messages_conversation_idx` — thread ordering
- `tickets_customer_email_idx` — customer history

---

## Event Pipeline

Five event delivery channels, unified by a dispatcher:

```
Ticket handler → dispatch()
                    ├─→ dispatchWebhook()     (HMAC signatures, retry, SSRF prevention)
                    ├─→ executePluginHook()    (plugin registry, sandboxed execution)
                    ├─→ eventBus.emit()        (SSE pub/sub, real-time UI)
                    ├─→ evaluateAutomation()   (time/event-based rules)
                    └─→ enqueueAIResolution()  (AI agent queue, quota-gated, ticket.created/message.created)
```

- **Canonical events**: `ticket.created`, `ticket.updated`, `ticket.resolved`, `message.created`, `csat.submitted`, `sla.breached`, `forum.thread_created`, `forum.reply_created`, `forum.thread_converted`, `qa.review_created`, `qa.review_completed`, `campaign.created`, `campaign.sent`, `customer.updated`, `customer.merged`, `time.entry_created`, `side_conversation.created`, `side_conversation.replied`
- **Internal note safety**: When `data.isNote=true` or `data.visibility='internal'`, AI resolution queue is skipped (no auto-reply on notes), customer emails are never sent
- Fire-and-forget via `Promise.allSettled` — errors isolated per channel with Sentry capture
- SSE uses colon-separated names (`ticket:created`); dispatcher translates

**Source:** `src/lib/events/dispatcher.ts`, `src/lib/events/index.ts`

---

## Job Queue Architecture

BullMQ + Redis for reliable background processing with graceful fallback to inline execution.

```
┌──────────────────────────────────────────────────────────────┐
│                    Queue Module (src/lib/queue/)               │
│                                                                │
│  connection.ts  → ioredis singleton (lazy-init, null-safe)    │
│  queues.ts      → 4 named BullMQ queues                       │
│  dispatch.ts    → enqueue*() helpers (returns false → inline)  │
│  stats.ts       → waiting/active/completed/failed counts       │
│                                                                │
│  workers/                                                      │
│  ├── webhook-worker.ts      (concurrency: 5)                  │
│  ├── automation-worker.ts   (concurrency: 1)                  │
│  ├── ai-resolution-worker.ts (concurrency: 2)                 │
│  └── email-worker.ts        (concurrency: 3)                  │
└──────────────────────────────────────────────────────────────┘
```

**Queues:**
| Queue | Job Type | Fallback |
|-------|----------|----------|
| `webhook-delivery` | HTTP POST with HMAC | Inline `sendWithRetry()` |
| `automation-scheduler` | Repeatable tick (60s) | `setInterval` |
| `ai-resolution` | AI agent pipeline | No-op (skipped) |
| `email-send` | SMTP via nodemailer | Inline `sendEmail()` |

**Key design:** Every `enqueue*()` returns `boolean`. When `false` (no Redis), callers fall back to existing inline behavior. Zero config change required for demo mode.

---

## Observability Stack

### Error Tracking (Sentry)
- `@sentry/nextjs` with client/server/edge configs
- DSN-gated: no-op when `SENTRY_DSN` unset
- `captureException` in webhook delivery, scheduler ticks, event dispatcher
- Global error boundary: `src/app/global-error.tsx`

### Metrics (Prometheus)
- `prom-client` registry at `src/lib/metrics.ts`
- Endpoint: `GET /api/metrics` (Prometheus text format)
- Metrics: `http_request_duration_seconds`, `http_requests_total`, `app_errors_total`, `queue_depth`, `queue_active_jobs` + Node.js defaults
- Queue gauges refreshed on each scrape

### Structured Logging (Pino)
- Centralized logger: `src/lib/logger.ts`
- `createLogger(module)` — child logger with module name
- `createRequestLogger(module, requestId)` — adds correlation ID
- Request ID: `X-Request-ID` header generated in middleware (`crypto.randomUUID()`)
- All 11 channel/email routes migrated from `console.log/error` to Pino

### Health Check
- `GET /api/health` — database connectivity (SELECT 1 + latency), Redis ping, queue stats
- Response: `{status: "ok"|"degraded", checks: {database, redis, queues}}`
- `not_configured` = OK (demo mode)

### Database Backup
- `scripts/db-backup.sh` — pg_dump + gzip + 7-day rotation
- Reads `DATABASE_URL` from `/opt/cliaas/shared/.env`
- Stores in `/opt/cliaas/backups/`

**Source:** `src/lib/metrics.ts`, `src/lib/logger.ts`, `sentry.*.config.ts`, `src/instrumentation.ts`

---

## Channel Architecture

### Email
- Inbound: webhook at `/api/channels/email/inbound`
- Outbound: Nodemailer via SMTP config
- Store: `src/lib/channels/email-store.ts`

### SMS / WhatsApp
- Provider: Twilio
- Webhooks: `/api/channels/sms/inbound`, `/api/channels/whatsapp/inbound`
- Outbound: `sendSms()`, `sendWhatsApp()` in `src/lib/channels/twilio.ts`
- Demo mode when `TWILIO_ACCOUNT_SID` not set

### Voice / Phone
- Provider: Twilio Voice
- IVR: configurable menu tree, TwiML generation (`<Gather>`, `<Say>`, `<Record>`, `<Dial>`)
- Webhooks: `/api/channels/voice/inbound` (IVR routing), `/api/channels/voice/status` (call completion)
- Voicemail → auto-creates ticket with recording URL
- Source: `src/lib/channels/voice-ivr.ts`, `src/lib/channels/voice-store.ts`

### Social Media
- Facebook/Instagram: Meta Graph API via `/api/channels/meta/webhook`
- Twitter/X: Account Activity API via `/api/channels/twitter/webhook`

### Chat Widget
- Embeddable widget: `/api/channels/chat/widget`
- Real-time via SSE

### Telegram
- Provider: Telegram Bot API
- Webhook: `/api/channels/telegram/webhook` (signature verification via webhook secret)
- Setup: `/api/channels/telegram/setup` (registers webhook with Telegram)
- Library: `src/lib/channels/telegram.ts` (sendMessage, setWebhook, getMe)
- Store: `src/lib/channels/telegram-store.ts` (bot configs + conversations)

### Slack as Intake
- Events API webhook: `/api/channels/slack/events` (signature verification)
- Slash commands: `/api/channels/slack/commands`
- Interactive components: `/api/channels/slack/interact`
- OAuth flow: `/api/channels/slack/oauth` + `/api/channels/slack/oauth/callback`
- Library: `src/lib/channels/slack-intake.ts` (message-to-ticket, bi-directional sync, JSONL mapping store)
- Channel mapping: Slack channel → CLIaaS inbox, auto-ticket creation

### MS Teams as Intake
- Bot Framework endpoint: `/api/channels/teams/messages`
- Auth config: `/api/channels/teams/auth`
- App manifest: `/api/channels/teams/manifest`
- Library: `src/lib/channels/teams-intake.ts` (Bot Framework REST API, adaptive cards)
- Uses `TEAMS_APP_ID` + `TEAMS_APP_PASSWORD` for authentication

### Mobile SDK
- Standalone JS package: `sdk/` directory, publishable as `@cliaas/sdk`
- Init + identify: `/api/sdk/init` (creates/identifies customer session)
- Messaging: `/api/sdk/messages` (send + poll/SSE)
- Attachments: `/api/sdk/attachments`
- Session management: `src/lib/channels/sdk-session.ts` (token-based auth)
- SDK API: `init()`, `identify()`, `open()`, `close()`, `on()`, `sendMessage()`, `getMessages()`

---

## Authentication & Security

### SSO
- SAML 2.0: XML signature verification, assertion parsing
- OIDC: Authorization Code flow with PKCE
- Config: `src/lib/auth/sso-config.ts`, `src/lib/auth/saml.ts`, `src/lib/auth/oidc.ts`

### Session Auth
- JWT signing with `AUTH_SECRET`
- Cookie-based sessions
- Source: `src/lib/auth/`

### Security Middleware
- Rate limiting: `src/lib/security/rate-limiter.ts`
- Security headers: `src/lib/security/headers.ts`
- Audit logging: `src/lib/security/audit-log.ts`
- SSRF prevention in webhooks: URL validation, private IP blocking
- Path traversal protection in sandbox IDs

### SOC 2 Compliance
- Compliance checks: `src/lib/compliance/soc2.ts`
- Audit trail for all state mutations

---

## CLI Architecture

```
cli/
├── index.ts              # Entry point (Commander)
├── config.ts             # ~/.cliaas/config.json management
├── data.ts               # JSONL file loading
├── commands/
│   ├── index.ts           # Registers all 31 command groups
│   ├── tickets.ts         # list, search, show
│   ├── triage.ts          # AI-powered prioritization
│   ├── draft.ts           # Response generation
│   ├── batch.ts           # Bulk operations
│   ├── migrate.ts         # Multi-connector migrations (553 LOC)
│   ├── rag.ts             # import, search, ask, status, test
│   ├── mcp.ts             # install, setup, test
│   ├── voice.ts           # record, transcribe
│   ├── sandbox.ts         # create, diff, promote
│   ├── customers.ts       # show, timeline, merge
│   ├── time.ts            # log, report
│   ├── forums.ts          # list, categories
│   ├── qa.ts              # review, dashboard
│   ├── campaigns.ts       # list, create, send
│   └── ...                # kb, sla, stats, sentiment, etc.
├── connectors/
│   ├── zendesk.ts         # 868 LOC — verify, export, CRUD
│   ├── kayako.ts          # Kayako modern API
│   ├── kayako-classic.ts  # Kayako legacy XML API
│   ├── freshdesk.ts       # Freshdesk
│   ├── helpcrunch.ts      # HelpCrunch
│   ├── groove.ts          # Groove
│   ├── intercom.ts        # Intercom
│   ├── helpscout.ts       # Help Scout
│   ├── zoho-desk.ts       # Zoho Desk
│   └── hubspot.ts         # HubSpot
├── providers/
│   ├── base.ts            # LLMProvider interface + prompt builders
│   ├── claude.ts          # Anthropic API
│   ├── openai.ts          # OpenAI API
│   ├── openclaw.ts        # Custom endpoint
│   └── index.ts           # getProvider() factory
├── rag/
│   ├── chunker.ts         # Document splitting strategies
│   ├── embedding.ts       # Vector generation
│   ├── retriever.ts       # Similarity search + ranking
│   ├── importer.ts        # File import pipeline
│   └── ...
└── mcp/
    ├── server.ts          # stdio transport entry point
    ├── util.ts            # Safe wrappers, result helpers
    ├── tools/             # 14 modules, 60 tools
    ├── resources/         # 6 resources
    └── prompts/           # 4 workflow prompts
```

### LLM Provider Pattern
```typescript
interface LLMProvider {
  name: string;
  complete(prompt: string): Promise<string>;
  generateReply(ticket, messages, opts?): Promise<string>;
  triageTicket(ticket, messages): Promise<TriageResult>;
  suggestKB(ticket, articles): Promise<KBSuggestion[]>;
  summarize(tickets, period?): Promise<string>;
}
```

Three implementations: Claude, OpenAI, OpenClaw. Selection via `getProvider()` which reads CLI config then falls back to env vars.

### Connector Pattern
Each connector exports: `verify`, `export`, `create`, `update`, `reply`, `list`. All normalize to canonical `Ticket`/`Message`/`KBArticle` types from `cli/schema/types.ts`.

### Continuous Sync Engine (`cli/sync/`)

The sync engine provides continuous connector sync without Redis or external dependencies:

- **Engine** (`cli/sync/engine.ts`): `runSyncCycle(connectorName, opts?)` reads cursor state from the previous export manifest, calls the connector's export function with that cursor (Zendesk supports incremental cursors; others do full re-export), writes JSONL to the output directory, and returns sync stats with new cursor state.
- **Worker** (`cli/sync/worker.ts`): `startSyncWorker(connectorName, opts?)` runs `runSyncCycle` on a configurable interval (default 5 minutes) using a simple `setTimeout` loop. Returns a handle with `stop()` and `isRunning()`.
- **CLI** (`cli/commands/sync.ts`): Three subcommands:
  - `cliaas sync run --connector <name>` — single cycle
  - `cliaas sync start --connector <name> [--interval <ms>]` — continuous worker with graceful SIGINT/SIGTERM shutdown
  - `cliaas sync status [--connector <name>]` — show cursor state and last sync time per connector
- **MCP tools** (`cli/mcp/tools/sync.ts`): `sync_status`, `sync_trigger`, `sync_pull`, `sync_push`, `sync_conflicts`, `upstream_push`, `upstream_status`, `upstream_retry` for AI agent access.
- **Auth resolution** (`cli/sync/auth.ts`): Shared `resolveConnectorAuth()` resolves each connector's credentials from standard env vars (e.g. `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_TOKEN`). Used by both downstream and upstream engines.

#### Hybrid Sync Layer (Phase 5)

The hybrid sync layer enables the Tier 3 (Hybrid) architecture where a local DB syncs bidirectionally with the hosted API:

- **HybridProvider** (`src/lib/data-provider/hybrid-provider.ts`): Implements DataProvider. Reads from local DbProvider (fast/offline). Writes go to local DB **and** insert a record into `sync_outbox` table (marked `pending_push`).
- **Sync Outbox** (`sync_outbox` table): Queues local changes for push to hosted. Fields: operation (`create`/`update`), entityType, entityId, payload (JSONB), status (`pending_push`/`pushed`/`conflict`/`failed`), timestamps.
- **Conflict Detection** (`cli/sync/conflict.ts`): `detectConflicts()` compares local outbox `createdAt` against hosted `updatedAt`. If hosted was modified after the local change was queued, flags as conflict. `partitionChanges()` splits entries into safe/conflicted groups.
- **Sync Operations** (`cli/sync/hybrid.ts`): `syncPull()` fetches from hosted (via RemoteProvider) and merges into local DB (hosted wins). `syncPush()` reads outbox, checks for conflicts, pushes safe entries to hosted API, records conflicts in `sync_conflicts` table. `listConflicts()` / `resolveConflict()` for conflict management.
- **CLI commands**: `cliaas sync pull`, `cliaas sync push`, `cliaas sync conflicts`, `cliaas sync resolve <id> --keep local|hosted`
- **MCP tools**: `sync_pull`, `sync_push`, `sync_conflicts`
- **Key principle**: Hosted always wins by default. Local-to-hosted push is an explicit user action with conflict warnings. No silent merges.

#### Upstream Sync (Push Changes to Source Platforms)

The upstream sync layer pushes changes made within CLIaaS back to the originating helpdesk platform (Zendesk, Freshdesk, etc.):

- **Outbox table** (`upstream_outbox`): Queues changes for push to source platforms. Fields: connector, operation (`create_ticket`/`update_ticket`/`create_reply`/`create_note`), ticketId, externalId, payload (JSONB), status (`pending`/`pushed`/`failed`/`skipped`), retryCount (max 3).
- **Adapter interface** (`cli/sync/upstream-adapter.ts`): `ConnectorWriteAdapter` normalizes write functions across all platforms. Each adapter maps CLIaaS statuses/priorities to platform-specific values. Capability flags (`supportsUpdate`, `supportsReply`) prevent unsupported operations.
- **Adapter implementations** (`cli/sync/upstream-adapters/`): 8 adapters (Zendesk, Freshdesk, Groove, HelpCrunch, Intercom, Help Scout, Zoho Desk, HubSpot). Factory: `getUpstreamAdapter(connector, auth)`.
- **Engine** (`cli/sync/upstream.ts`): `enqueueUpstream()` inserts into outbox (no-op without DATABASE_URL). `upstreamPush()` processes pending entries by connector group. `upstreamStatus()` returns aggregate counts. `upstreamRetryFailed()` resets failed entries with retryCount < 3.
- **MCP hooks**: `ticket_update`, `ticket_reply`, `ticket_note` in `cli/mcp/tools/actions.ts` auto-enqueue when the ticket has a `source` and `externalId`. `ticket_create` accepts an optional `source` parameter.
- **CLI commands**: `cliaas sync upstream push [--connector]`, `cliaas sync upstream status [--connector]`, `cliaas sync upstream retry [--connector]`
- **MCP tools**: `upstream_push`, `upstream_status`, `upstream_retry`
- **Key principle**: Explicit push (not automatic). Missing auth → entries marked `skipped`. Unsupported operations → `skipped`. Max 3 retries for failed entries.

| Connector | updateTicket | postReply | postNote | createTicket | Notes |
|-----------|:-----------:|:---------:|:--------:|:------------:|-------|
| Zendesk | Y | Y | Y | Y | Reverse status mapping |
| Freshdesk | Y | Y | Y | Y | Numeric status/priority codes |
| Groove | Y | Y | Y | Y | Uses `ticketNumber` |
| HelpCrunch | Y | Y | Y | Y | Chat model, numeric IDs |
| Intercom | N | Y | Y | Y | Requires `INTERCOM_ADMIN_ID` |
| Help Scout | N | Y | Y | Y | Requires `HELPSCOUT_MAILBOX_ID` |
| Zoho Desk | N | Y | Y | Y | No update function |
| HubSpot | N | N | Y | Y | Most limited |

---

## Frontend Architecture

### Pages (38)

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/dashboard` | Ticket queue with filters |
| `/tickets` | Ticket list + detail views |
| `/customers` | Customer directory |
| `/customers/[id]` | Customer 360 detail (enriched profile, timeline, notes) |
| `/kb` | Knowledge base management |
| `/channels` | Email, SMS, WhatsApp, Voice, Social, Telegram, Slack, Teams config |
| `/ai` | AI assistant, triage, sentiment |
| `/analytics` | Charts, CSAT, response times |
| `/billing` | Plan management, usage meters, Stripe checkout |
| `/automation` | Rules, triggers, macros |
| `/sla` | SLA policy management |
| `/business-hours` | Business hours schedules & holiday calendars (gated: `sla_management`) |
| `/integrations` | Connector configuration |
| `/settings` | Workspace settings |
| `/sandbox` | Sandbox environment management |
| `/compliance` | SOC 2 audit dashboard |
| `/forums` | Community forum management (gated: `community_forums`) |
| `/qa` | QA dashboard + review workflow (gated: `qa_reviews`) |
| `/campaigns` | Campaign builder + list (gated: `proactive_messaging`) |
| `/portal` | Customer self-service portal |
| `/portal/forums` | Customer-facing forums |
| `/portal/forums/[categorySlug]` | Forum category view |
| `/portal/forums/thread/[id]` | Forum thread detail |
| `/offline` | PWA offline fallback |
| ...and more | |

### Design System
- Tailwind CSS v4 with zinc color palette
- Brutalist monospace aesthetic (dark background, sharp borders)
- No component library — custom components throughout
- Responsive via Tailwind breakpoints

### PWA
- Service worker: network-only for API, cache-first for static assets
- Web Push notifications via VAPID
- Installable on mobile (manifest.json with 192/512 icons)
- Offline fallback page at `/offline`

---

## Deployment

### VPS (Production)
```
scripts/deploy_vps.sh  →  6-stage pipeline:
  1. Remote directory creation (/opt/cliaas/)
  2. rsync source code
  3. pnpm install + next build
  4. Systemd service install + restart
  5. Health check (curl /api/health)
  6. Nginx reverse proxy config
```

- **Host:** cliaas.com (VPS, Ubuntu)
- **User:** ubuntu (not root)
- **Port:** 3101
- **Data:** `/home/ubuntu/cliaas-data` (JSONL files)
- **Process:** systemd (`cliaas.service`)
- **Proxy:** nginx with WebSocket support

### CI/CD
- GitHub Actions: typecheck → test → build on push/PR
- Manual deploy via `scripts/deploy_vps.sh`

### Docker (Development)
- `docker-compose.yml`: pgvector/pgvector:pg16 on port 5433, redis:7-alpine on port 6379
- `pnpm db:setup`: compose up → migrate → seed

---

## Testing Strategy

| Layer | Tool | Files | Coverage |
|-------|------|-------|----------|
| Unit (lib) | Vitest | 17 files | Core stores, security, channels, auth, events, push, sandbox |
| Unit (CLI) | Vitest | 9 files | RAG pipeline (7), MCP server (2) |
| Component | Vitest + jsdom | 5 files | AppNav, ConnectorCard, TicketActions, page renders |
| API Integration | Vitest | 4 files | health, auth, tickets, webhooks |
| DB Integration | Vitest | 3 files | schema, queries, ingest |
| E2E | Playwright | 1 file | Easter Egg QA (Konami code → 4 missions) |

**Run:** `pnpm test` (all), `pnpm test:db` (database), `pnpm test:qa` (Playwright)

---

## Environment Variables

See `.env.example` for full reference. Key categories:

| Category | Count | Required |
|----------|-------|----------|
| Core (PORT, HOST, NODE_ENV) | 4 | Yes |
| Database (DATABASE_URL, RAG_DATABASE_URL) | 2 | No (JSONL fallback) |
| Auth (AUTH_SECRET) | 1 | Production only |
| AI (ANTHROPIC_API_KEY, OPENAI_API_KEY) | 2 | For AI features |
| Channels (Twilio, Meta, Twitter) | 12 | Per-channel |
| Connectors (Zendesk, Freshdesk, etc.) | 25+ | Per-connector |
| Email (SMTP_*) | 5 | For email channel |
| Logging (LOG_LEVEL) | 1 | No |

---

## Product Vision & Tiering

CLIaaS is an AI-native helpdesk platform. The core value proposition: we make it as easy as possible for AI agents (Claude Code, etc.) to read, triage, and act on support tickets — without locking customers into proprietary AI features or workflows. Customers bring their own AI, their own processes, their own infrastructure if they want. We provide the rails.

### Three Tiers

**Tier 1 — BYOC (Bring Your Own Computer) — Free**
- Open source repo, clone and run an install wizard
- Wizard lives in a `WIZARD/` folder: custom `claude.md` + `agents.md` that walks the user through setup, then stays out of the way
- Sets up local Postgres, syncs from existing helpdesk via connectors
- MCP server runs locally against local DB
- Minimal/functional GUI — ticket list, detail view, basic dashboard. No premium features.
- Customer owns everything; if CLIaaS disappears, nothing breaks
- Target: technical teams, self-hosters, tinkerers, anyone who wants full control

**Tier 2 — Hosted — Paid**
- Data lives on CLIaaS infrastructure
- Full GUI with all premium features (analytics, AI dashboard, advanced automation, etc.)
- MCP connects to CLIaaS API (remote)
- We manage infra, backups, scaling
- Target: teams who want it to Just Work

**Tier 3 — Hybrid — Paid**
- Hosted DB (source of truth) + local DB that syncs down
- Locally-created data (e.g. manual ticket entry) requires explicit "push upstream" action — not silent merge, clear user action with conflict warnings
- If CLIaaS goes down, local copy keeps working
- Full GUI + premium features
- Target: enterprises, teams that need both convenience and resilience

### Key Architectural Implications

1. **MCP server is tier-agnostic**: Same 60 tools, same interface, different backends. A customer can start BYOC, upgrade to hosted, and their AI workflows don't change.
2. **Connectors are ongoing sync, not one-time import**: In BYOC/hybrid mode, connectors maintain continuous sync with source helpdesks. Different reliability bar than one-shot migration.
3. **Data layer must be backend-abstract**: The MCP server and business logic should talk to a DataProvider interface, not directly to Postgres or JSONL. Backends: local-postgres, remote-api, jsonl-file, hybrid-sync.
4. **GUI feature gating**: Free tier gets functional-but-minimal UI. Paid tier unlocks premium pages/features. Gating at the route/component level.
5. **Wizard-driven onboarding**: BYOC setup is a guided process via claude.md/agents.md in a WIZARD/ folder. AI-assisted infrastructure provisioning.
6. **Sync layer for hybrid** (Phase 5 complete): HybridProvider + sync_outbox + conflict detection. Hosted→local pull, outbox-based push, conflict resolution via `sync_conflicts` table. CLI + MCP tools for all operations.

### GUI Feature Gating (Phase 4)

Feature gating controls which GUI pages are available based on the tenant's plan tier. Implementation:

- **Feature matrix** (`src/lib/features/gates.ts`): Defines 10 gateable features and which of 6 tier levels unlock each. BYOC and Enterprise unlock everything.
- **Tier resolution** (`src/lib/features/index.ts`): `getTierForTenant()` reads the tenant's plan from DB; falls back to `byoc` when no DB is available (self-hosted mode gets full access).
- **FeatureGate component** (`src/components/FeatureGate.tsx`): Async server component that wraps premium page content. Renders children if feature is enabled, otherwise shows an upgrade prompt card linking to `/billing`.
- **Gated pages**: Analytics, AI Dashboard, Sandbox, SLA Management, Channels. Each page has a `_content.tsx` client component and a `page.tsx` server wrapper that applies the gate.
- **Ungated pages**: Dashboard, Tickets, KB, Customers, Settings (always available).
- **BYOC plan** added to `src/lib/billing/plans.ts` with unlimited quotas and $0 price.

Feature matrix summary:
| Feature | free | founder | starter | pro | enterprise | byoc |
|---------|------|---------|---------|-----|------------|------|
| analytics | - | Y | Y | Y | Y | Y |
| ai_dashboard | - | Y | - | Y | Y | Y |
| sla_management | - | Y | Y | Y | Y | Y |
| voice_channels | - | - | Y | Y | Y | Y |
| social_channels | - | - | Y | Y | Y | Y |
| advanced_automation | - | - | - | Y | Y | Y |
| compliance | - | - | - | Y | Y | Y |
| sandbox | - | - | - | Y | Y | Y |
| custom_branding | - | - | - | Y | Y | Y |
| sso | - | - | - | - | Y | Y |
| community_forums | Y | Y | Y | Y | Y | Y |
| qa_reviews | Y | Y | Y | Y | Y | Y |
| proactive_messaging | Y | Y | Y | Y | Y | Y |
| canned_responses | Y | Y | Y | Y | Y | Y |

## Key Design Decisions

1. **JSONL-first persistence** — Zero-dependency demo mode. No database needed to try CLIaaS.
2. **Global singleton stores** — Survive Next.js HMR in development. Each store uses `global.__cliaa*` pattern.
3. **Fire-and-forget events** — Event dispatch never blocks ticket operations. Errors isolated per delivery channel.
4. **CLI and web share business logic** — `src/lib/` is the single source of truth. Both CLI commands and API routes import from it.
5. **Provider abstraction** — LLM operations work with Claude, OpenAI, or custom endpoints via a single interface.
6. **Connector normalization** — All 10 helpdesk platforms normalize to canonical `Ticket`/`Message` types.
7. **Multi-tenant from ground up** — Every DB table scoped to `workspaceId`. Tenant → Workspace → Users hierarchy.
8. **PWA over native** — Progressive Web App provides mobile access without maintaining native apps.

---

## Known Technical Debt

### High Priority
- **Auth middleware gap**: ~88% of API routes lack authentication checks
- **Connector duplication**: ~4,700 LOC across 10 connectors with repeated auth, pagination, and normalization patterns

### Medium Priority
- **Test coverage**: CLI commands and connectors have zero test coverage (~2,000 LOC untested critical path)
- **Color map duplication**: Priority/status color maps repeated across 22+ components
- **Large files**: `/ai` page (1,275 LOC), `zendesk.ts` connector (868 LOC)
- **ID generation**: 6 different `randomId()` implementations across the codebase

### Low Priority
- **No `--json` CLI output**: Commands can't be piped or scripted
- **Inconsistent spinner usage**: Some long operations lack progress feedback
- **4 persistence patterns**: `JsonlStore`, raw `readFileSync`, global singletons, and Drizzle ORM — could consolidate

### Resolved (Session 30)
- ~~Unsafe JSON parsing~~: All 38 routes migrated to `parseJsonBody` utility (standardized 400 errors)
- ~~SCIM PatchOp format~~: Corrected to RFC 7644, timing-safe auth, store consolidation
- ~~Automation side effects gap~~: Engine now propagates notifications/webhooks through full execution chain
- ~~Connector type fragmentation~~: Single `CONNECTOR_REGISTRY` source of truth created
- ~~Approval queue duplication~~: Extracted `transitionEntry` helper
- ~~Magic-link memory leak~~: `cleanupExpiredTokens()` called on each token generation

---

## Enterprise Readiness Roadmap

6-week plan to bring CLIaaS to production-grade enterprise readiness.

### Week 1–2: Auth & API Keys
- Wire `requireAuth` middleware to all ~101 API routes (currently ~88% unprotected)
- Build API key CRUD system (create, list, revoke, scoped permissions)
- Add MFA via TOTP (Time-based One-Time Password)
- Rate limiting per API key
- Auth tests covering all protected routes

### Week 3: Job Queue + Observability ✅
- BullMQ + Redis job queues (4 queues, 4 workers, inline fallback)
- Sentry error tracking (`@sentry/nextjs`, DSN-gated)
- Prometheus metrics endpoint (`GET /api/metrics`)
- Structured logging: 11 files migrated to Pino, request correlation IDs
- Database backup: `scripts/db-backup.sh` (pg_dump + 7-day rotation)
- Health endpoint enhanced with DB/Redis/queue checks

### Week 4: Billing ✅
- Stripe Checkout integration (`stripe` SDK, webhook signature verification)
- 5 plan tiers: Founder (early-adopter promo), Free, Starter ($29), Pro ($99), Enterprise (custom)
- Founder plan: Pro-level quotas for free, locked in for tenants created before Feb 28 2026
- Usage metering: tickets/month, AI calls, API requests (`usage_metrics` table, UPSERT with period)
- Quota enforcement: ticket creation (429 on limit), AI resolution (skipped on limit), API metering
- Billing management: `/billing` page (usage meters, plan cards, subscription management)
- Stripe webhook: `checkout.session.completed`, `subscription.updated/deleted`, `invoice.payment_failed`
- Idempotent event processing via `billing_events.stripe_event_id` unique index
- Demo-safe: all billing functions no-op when `DATABASE_URL` or `STRIPE_SECRET_KEY` unset

### Week 5: Compliance & Security ✅
- **Audit persistence**: `recordAudit()` / `recordSecureAudit()` now async with DB-primary writes, WAL buffer for retry on transient failures (`src/lib/audit-wal.ts`), `workspaceId` on all audit entries
- **GDPR hardening**: Real DB operations (`src/lib/compliance/gdpr-db.ts`) — `exportUserDataFromDb()` queries all user data, `deleteUserDataFromDb()` transactional anonymization with `gdpr_deletion_requests` tracking. Deletion requires `confirmDelete: true`. All operations audit-logged.
- **Retention policies**: Persisted to DB (`retention_policies` table), enforcement scheduler (`src/lib/compliance/retention-scheduler.ts`), manual trigger via `POST /api/compliance/retention/enforce`
- **Row-Level Security**: `workspace_id` denormalized into 15 child tables, RLS enabled on all 37+ tables, `SET LOCAL` transaction wrappers (`src/db/rls.ts`), `cliaas_app` non-superuser role (`scripts/setup-rls-roles.sql`), `DATABASE_APP_ROLE_URL` env var for RLS-compatible connections
- **Secrets management**: SOPS + age encryption at rest (`scripts/secrets-encrypt.sh`, `scripts/secrets-decrypt.sh`, `scripts/secrets-rotate.sh`), systemd `ExecStartPre` decryption, `.sops.yaml` config
- **Security hardening**: CSP tightened (form-action, base-uri, COOP, CORP), HSTS preload, X-XSS-Protection disabled (modern best practice), request body size validation (10MB), explicit CORS configuration, `scripts/security-audit.sh`, pentest checklist (`docs/pentest-checklist.md`)
- **New tables**: `gdpr_deletion_requests`, `retention_policies` + 15 denormalized `workspace_id` columns
- **Migrations**: `0003_compliance_hardening.sql`, `0004_row_level_security.sql`
- **Tests**: 87 new tests across 10 files (audit-persistence, gdpr-db, retention-scheduler, rls, rls-denormalization, secrets-scripts, security/headers, security/auth-bypass, security/cross-tenant, security/input-validation). Total: **772 tests passing**.

### Week 6: Testing & Launch Prep
- Auth integration tests for all 101 routes
- Connector integration tests (at least smoke tests per connector)
- Load testing (k6 or Artillery)
- SOC 2 documentation finalization
- Production deployment checklist and runbook
