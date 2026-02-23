# CLIaaS Architecture

> Command-Line Native SaaS — an enterprise helpdesk platform with CLI-first design, AI triage, and 10+ connector integrations.

**Live:** https://cliaas.com | **Repo:** github.com/discordwell/CLIaaS

## Project Stats

| Metric | Value |
|--------|-------|
| Pages | 29 (Next.js App Router) |
| API Routes | 101 |
| Components | 14 shared React components |
| Library modules | 58 (`src/lib/`) |
| CLI files | 69 (`cli/`) |
| CLI commands | 31 registered command groups |
| Connectors | 10 helpdesk integrations |
| MCP tools | 18 (across 6 modules) |
| MCP resources | 6 |
| MCP prompts | 4 workflow prompts |
| DB tables | 53 (Drizzle/PostgreSQL) |
| Tests | 38 files, ~5,300 LOC |
| Source LOC | ~47,600 (excl. Easter Egg + tests) |
| Dependencies | 19 prod + 19 dev |

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
│  29 pages       │ │  31 commands │ │  18 tools        │
│  101 API routes │ │  10 connect. │ │  6 resources     │
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
└────────┬──────────────────┬──────────────────┬──────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  PostgreSQL     │ │  JSONL Files │ │  External APIs   │
│  53 tables      │ │  (demo mode) │ │  Twilio, Meta,   │
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

---

## Database Schema (53 tables)

### Core Multi-Tenancy (3)
`tenants` → `workspaces` → `users`

### Tickets & Conversations (5)
`tickets` → `conversations` → `messages` → `attachments`, `groups`

### Customers (2)
`customers`, `organizations`

### Channels (1)
`inboxes` (email, chat, api, sms, phone, web, whatsapp, facebook, instagram, twitter)

### Configuration (4)
`brands`, `ticket_forms`, `custom_fields`, `custom_field_values`

### Rules & Automation (3)
`rules` (macros, triggers, automations, SLA), `automation_rules`, `sla_policies`

### SLA Tracking (1)
`sla_events` (breach detection)

### Views & Tags (3)
`views`, `tags`, `ticket_tags`

### CSAT & Time (2)
`csat_ratings`, `time_entries`

### Knowledge Base (4)
`kb_collections` → `kb_categories` → `kb_articles` → `kb_revisions`

### Integration & Sync (4)
`integrations`, `external_objects` (ID mapping), `sync_cursors`, `raw_records`

### Jobs (2)
`import_jobs`, `export_jobs`

### SSO (1)
`sso_providers` (SAML + OIDC)

### Audit (2)
`audit_events`, `audit_entries`

### RAG (2)
`rag_chunks` (vector(1536)), `rag_import_jobs`

### Key Indexes
- `tickets_workspace_status_idx` — queue queries
- `messages_conversation_idx` — thread ordering
- `tickets_customer_email_idx` — customer history

---

## Event Pipeline

Three event delivery systems, unified by a dispatcher:

```
Ticket handler → dispatch()
                    ├─→ dispatchWebhook()  (HMAC signatures, retry, SSRF prevention)
                    ├─→ executePluginHook() (plugin registry, sandboxed execution)
                    └─→ eventBus.emit()     (SSE pub/sub, real-time UI)
```

- **Canonical events**: `ticket.created`, `ticket.updated`, `ticket.resolved`, `message.created`, `csat.submitted`, `sla.breached`
- Fire-and-forget via `Promise.allSettled` — errors isolated per channel
- SSE uses colon-separated names (`ticket:created`); dispatcher translates

**Source:** `src/lib/events/dispatcher.ts`, `src/lib/events/index.ts`

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
    ├── tools/             # 6 modules, 18 tools
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

---

## Frontend Architecture

### Pages (29)

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/dashboard` | Ticket queue with filters |
| `/tickets` | Ticket list + detail views |
| `/customers` | Customer directory |
| `/kb` | Knowledge base management |
| `/channels` | Email, SMS, WhatsApp, Voice, Social config |
| `/ai` | AI assistant, triage, sentiment |
| `/analytics` | Charts, CSAT, response times |
| `/automation` | Rules, triggers, macros |
| `/sla` | SLA policy management |
| `/integrations` | Connector configuration |
| `/settings` | Workspace settings |
| `/sandbox` | Sandbox environment management |
| `/compliance` | SOC 2 audit dashboard |
| `/portal` | Customer self-service portal |
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
- `docker-compose.yml`: pgvector/pgvector:pg16 on port 5433
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
- **Unsafe JSON parsing**: ~52 routes use `await request.json()` without try/catch
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
