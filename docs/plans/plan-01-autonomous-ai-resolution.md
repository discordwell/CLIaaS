# Plan 01: Autonomous AI Resolution Engine

## 1. Summary of What Exists Today

### AI Agent (`src/lib/ai/agent.ts`)
- Full prompt construction and LLM completion pipeline (Anthropic + OpenAI) — **functional**
- `runAgent()` calls the LLM, parses JSON response, scores confidence, returns `AIAgentResult` (`:230-297`)
- Config includes confidence threshold (default 0.7), topic exclusion list, KB context toggle (`:18-26`)
- **Problem**: Agent is `enabled: false` by default (`:52`), and stats are stored in a **global in-memory singleton** (`:62-100`) — lost on process restart

### AI Resolution Worker (`src/lib/queue/workers/ai-resolution-worker.ts`)
- BullMQ worker exists but is a **complete no-op** — receives job, logs it, returns `{status: 'skipped'}` (`:20-24`)
- Never calls `runAgent()`, never sends a reply, never updates the ticket

### Event Dispatcher (`src/lib/events/dispatcher.ts`)
- Already fans out `ticket.created` and `message.created` events to the AI resolution queue (`:85-88`, `:141-162`)
- Already checks billing quota before enqueueing (`:144-151`)
- Pipeline: event → quota check → `enqueueAIResolution()` → BullMQ → no-op worker

### Approval Queue (`src/lib/ai/approval-queue.ts`)
- In-memory array with `enqueue`, `approve`, `reject`, `edit` operations — **functional but ephemeral**
- No DB persistence, no UI integration, no post-approval action (approved entries just sit in memory)

### ROI Tracker (`src/lib/ai/roi-tracker.ts`)
- In-memory counters: totalResolutions, aiResolved, escalated, avgConfidence, estimatedTimeSaved
- Hardcoded assumptions: 8 min/resolution, $0.03/LLM call — **no persistence**

### Billing/Usage (`src/lib/billing/usage.ts`)
- DB-backed usage tracking with `ai_call` metric — **production-ready**
- `checkQuota()` + `incrementUsage()` with upsert on `usage_metrics` table
- Already integrated into the event dispatcher

### MCP Tool (`cli/mcp/tools/actions.ts:309-342`)
- `ai_resolve` tool exists with confirmation pattern, but just logs the action and returns a message — **does not actually trigger AI resolution**

### LLM Providers (`cli/providers/`)
- Abstracted provider interface (`base.ts:15-22`): `complete()`, `generateReply()`, `triageTicket()`, `suggestKB()`, `summarize()`
- Claude, OpenAI, OpenClaw implementations — **production-ready**

### DB Schema (`src/db/schema.ts`)
- `messages` table has `authorType` enum including `'bot'` and `visibility` enum (`'public'`/`'internal'`) — bot replies can be stored
- `tickets` table has all needed fields (status, priority, assignee, tags, customFields)
- `usage_metrics` table tracks `ai_calls_made` per tenant per period
- **No `ai_resolutions` table** — no persistent record of AI resolution attempts

### Email/Channel Sending
- `src/lib/email/sender.ts` — email sending exists
- Channel-specific senders: Slack, Telegram, Teams, SMS (Twilio), Meta, Twitter — all functional
- BullMQ `email-send` queue with worker exists

### What's Missing (Gap Summary)
1. Worker is a no-op — never calls `runAgent()`
2. No "action framework" — AI can analyze but can't update tickets, send replies, or close
3. Approval queue is in-memory, has no post-approval action
4. Stats/ROI tracking is in-memory — lost on restart
5. No persistent AI resolution history table
6. No safety rails (PII detection, hallucination guards)
7. No multi-channel reply sending from AI
8. No configurable Procedures (natural-language instruction sets)
9. MCP tool is a stub

---

## 2. Proposed DB Schema Changes

### New Table: `ai_resolutions`
```sql
CREATE TABLE ai_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  conversation_id UUID REFERENCES conversations(id),

  -- LLM output
  confidence REAL NOT NULL,
  suggested_reply TEXT NOT NULL,
  reasoning TEXT,
  kb_articles_used TEXT[] DEFAULT '{}',

  -- Resolution outcome
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | auto_resolved | approved | rejected | edited | escalated | error
  final_reply TEXT,              -- what was actually sent (may differ if edited)

  -- Action metadata
  actions_taken JSONB DEFAULT '[]',  -- [{type: 'set_status', value: 'solved'}, ...]
  escalation_reason TEXT,
  error_message TEXT,

  -- Audit
  provider VARCHAR(20),          -- claude | openai | openclaw
  model VARCHAR(100),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_cents REAL,
  latency_ms INTEGER,

  -- Review
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_resolutions_ticket_idx ON ai_resolutions(ticket_id);
CREATE INDEX ai_resolutions_tenant_status_idx ON ai_resolutions(tenant_id, status);
CREATE INDEX ai_resolutions_created_idx ON ai_resolutions(created_at);
```

### New Table: `ai_procedures`
```sql
CREATE TABLE ai_procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),

  name VARCHAR(200) NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,   -- Natural-language multi-step instructions

  -- Matching
  trigger_conditions JSONB,     -- {tags: [...], priority: [...], subject_contains: [...]}
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,  -- Higher = evaluated first

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_procedures_workspace_idx ON ai_procedures(workspace_id, enabled);
```

### New Table: `ai_agent_configs`
```sql
CREATE TABLE ai_agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),

  enabled BOOLEAN NOT NULL DEFAULT false,
  mode VARCHAR(20) NOT NULL DEFAULT 'suggest',  -- suggest | approve | auto
  confidence_threshold REAL NOT NULL DEFAULT 0.7,
  provider VARCHAR(20) NOT NULL DEFAULT 'claude',
  model VARCHAR(100),
  max_tokens INTEGER NOT NULL DEFAULT 1024,

  excluded_topics TEXT[] DEFAULT '{billing,legal,security}',
  kb_context BOOLEAN NOT NULL DEFAULT true,

  -- Safety
  pii_detection BOOLEAN NOT NULL DEFAULT true,
  max_auto_resolves_per_hour INTEGER DEFAULT 50,
  require_kb_citation BOOLEAN NOT NULL DEFAULT false,

  -- Channel config
  channels TEXT[] DEFAULT '{email,chat,web}',  -- which channels AI can reply on

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, workspace_id)
);
```

### Modify Existing: `usage_metrics`
Add column:
```sql
ALTER TABLE usage_metrics ADD COLUMN ai_resolutions INTEGER NOT NULL DEFAULT 0;
```

---

## 3. New API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/ai/config` | Get AI agent config for workspace |
| PUT | `/api/ai/config` | Update AI agent config |
| GET | `/api/ai/resolutions` | List resolution history (paginated, filterable) |
| GET | `/api/ai/resolutions/[id]` | Get single resolution detail |
| POST | `/api/ai/resolutions/[id]/approve` | Approve pending resolution → send reply |
| POST | `/api/ai/resolutions/[id]/reject` | Reject pending resolution |
| POST | `/api/ai/resolutions/[id]/edit` | Edit reply and approve |
| GET | `/api/ai/resolutions/stats` | Aggregated stats (replaces in-memory ROI) |
| POST | `/api/ai/resolve` | Manually trigger AI resolution for a ticket |
| GET | `/api/ai/procedures` | List procedures |
| POST | `/api/ai/procedures` | Create procedure |
| PUT | `/api/ai/procedures/[id]` | Update procedure |
| DELETE | `/api/ai/procedures/[id]` | Delete procedure |
| GET | `/api/ai/approval-queue` | List pending approvals (DB-backed) |

---

## 4. New/Modified UI Pages/Components

### New Pages
- `/ai/config` — AI agent configuration (enable/disable, mode, threshold, providers, excluded topics)
- `/ai/resolutions` — Resolution history table with filters (status, date, confidence, ticket)
- `/ai/procedures` — Procedure CRUD with natural-language editor
- `/ai/dashboard` — AI resolution analytics (resolution rate, avg confidence, time saved, cost, trend charts)

### Modified Pages
- `/tickets/[id]` — Add AI resolution indicator badge, show AI-suggested reply in a collapsible panel when pending approval
- `/dashboard` — Add AI resolution KPI cards (rate, pending approvals count)

### New Components
- `AIResolutionBadge` — Shows resolution status on ticket (auto-resolved, AI-suggested, escalated)
- `AIApprovalPanel` — Inline approve/reject/edit panel in ticket detail
- `AIProcedureEditor` — Form for creating/editing procedures with condition builder
- `AIConfigForm` — Settings form for AI agent configuration

---

## 5. New CLI Commands

| Command | Purpose |
|---------|---------|
| `cliaas ai config` | Show/set AI agent configuration |
| `cliaas ai resolve <ticketId>` | Manually trigger AI resolution for a ticket |
| `cliaas ai resolutions` | List recent AI resolution attempts |
| `cliaas ai stats` | Show AI resolution statistics |
| `cliaas ai procedures list` | List configured procedures |
| `cliaas ai procedures create` | Create a new procedure interactively |
| `cliaas ai procedures toggle <id>` | Enable/disable a procedure |
| `cliaas ai approve <id>` | Approve a pending AI resolution |
| `cliaas ai reject <id>` | Reject a pending AI resolution |

---

## 6. New MCP Tools

| Tool | Purpose |
|------|---------|
| `ai_resolve` | **Fix existing stub** — actually trigger AI resolution pipeline |
| `ai_config` | Get/set AI agent configuration |
| `ai_stats` | Get AI resolution statistics from DB |
| `ai_approve` | Approve a pending AI resolution |
| `ai_reject` | Reject a pending AI resolution |
| `ai_procedures_list` | List AI procedures |
| `ai_procedures_create` | Create a new AI procedure |

---

## 7. Migration/Rollout Plan

### Phase 1: Foundation (M effort)
1. **DB migration**: Create `ai_resolutions`, `ai_procedures`, `ai_agent_configs` tables; add `ai_resolutions` column to `usage_metrics`
2. **Wire the worker**: Replace no-op in `ai-resolution-worker.ts` with actual `runAgent()` call
   - Load ticket + messages from DB/JSONL
   - Load matching KB articles via RAG retriever
   - Match applicable procedures and inject into prompt
   - Call `runAgent()`
   - Persist result to `ai_resolutions` table
3. **Action execution**: After successful resolution, execute actions based on mode:
   - `suggest` mode: Store result, emit SSE event for UI notification
   - `approve` mode: Store result as pending, add to approval queue (DB)
   - `auto` mode: Send reply via appropriate channel, update ticket status, store result as auto_resolved
4. **Reply sending**: Build multi-channel reply dispatcher
   - Determine ticket's originating channel
   - Route to email sender, Slack, chat widget, etc.
   - Create message record in DB with `authorType: 'bot'`

### Phase 2: Safety & Control (M effort)
5. **PII detection**: Regex-based scanner for SSN, credit cards, phone numbers in AI replies before sending
6. **Hallucination guard**: If `require_kb_citation` is on, reject replies that don't cite a KB article
7. **Rate limiting**: Enforce `max_auto_resolves_per_hour` per workspace
8. **Config API + UI**: Build config page, persist settings to `ai_agent_configs`
9. **Approval workflow**: DB-backed approval queue with approve/reject/edit → triggers reply send

### Phase 3: Intelligence (L effort)
10. **Procedures engine**: Match procedures to tickets by conditions, inject matched procedure instructions into the agent prompt
11. **Resolution analytics**: Build stats API querying `ai_resolutions` table (resolution rate, avg confidence, cost, time saved by period)
12. **AI dashboard page**: Charts and KPI cards
13. **Feedback loop**: Track CSAT on AI-resolved tickets vs human-resolved, surface in analytics

### Phase 4: Polish (S effort)
14. **MCP tools**: Fix `ai_resolve` stub, add new tools
15. **CLI commands**: Wire up `cliaas ai *` commands
16. **Ticket detail integration**: AI resolution badge, inline approval panel
17. **ROI tracker migration**: Replace in-memory `roi-tracker.ts` with DB queries

### Rollout Safety
- Ship with `enabled: false` default — explicit opt-in per workspace
- Start with `suggest` mode (human reviews all AI drafts) before enabling `auto`
- Log all LLM calls to `ai_resolutions` regardless of mode for audit trail
- Monitor cost via existing `usage_metrics.ai_calls_made` + new `ai_resolutions` cost tracking

---

## 8. Effort Estimate

**Overall: L (Large)**

| Phase | Effort | Reasoning |
|-------|--------|-----------|
| Phase 1: Foundation | M | Worker wiring is straightforward since `runAgent()` exists; multi-channel reply dispatch is the complex part |
| Phase 2: Safety & Control | M | PII regex is simple; config UI is standard CRUD; approval workflow needs careful state management |
| Phase 3: Intelligence | L | Procedures engine is new; analytics queries + charting is significant frontend work |
| Phase 4: Polish | S | CLI/MCP tools follow existing patterns |

**Key risk**: Multi-channel reply sending. Each channel (email, Slack, chat widget, SMS) has different APIs and formatting requirements. The existing channel senders exist but haven't been composed into a unified "reply on behalf of bot" flow.

**Key dependency**: RAG retriever (`cli/rag/`) for KB article lookup in the resolution pipeline. The retriever exists but needs to be callable from the worker context (currently used from MCP tools).

**Estimated files changed**: ~25 new files, ~10 modified files
**Estimated new lines of code**: ~3,000-4,000
