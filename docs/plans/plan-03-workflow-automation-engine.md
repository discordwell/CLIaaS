# Plan 03: Workflow Automation Engine

## 1. Summary of What Exists Today

CLIaaS has a **two-tier automation system**: low-level rules and high-level visual workflows.

### Tier 1: Rule Engine (automation/*)
- **Engine** (`src/lib/automation/engine.ts:1-139`): Pure-function rule evaluator. `Rule` type has 4 types: `trigger`, `macro`, `automation`, `sla`. Evaluates conditions → executes actions → returns `ExecutionResult` with changes, notifications, webhooks.
- **Conditions** (`src/lib/automation/conditions.ts:1-126`): 15 operators (is, is_not, contains, greater_than, changed, changed_to, matches regex, etc.) across 11 fields (status, priority, assignee, tags, hours_since_*, custom fields). Supports `all` (AND) + `any` (OR) groups.
- **Actions** (`src/lib/automation/actions.ts:1-141`): 13 action types (set_status, set_priority, assign, tag, set_field, add_internal_note, send_notification, webhook, close, reopen, escalate).
- **Executor** (`src/lib/automation/executor.ts:1-176`): Wraps engine with audit trail and event dispatcher integration.
  - **CRITICAL GAP**: Rule storage is **global in-memory** (`executor.ts:24-28`, globals `__cliaasAutomationRules` and `__cliaasAutomationAudit`). Rules loaded from DB are cached in memory but not synced back.
  - **CRITICAL GAP**: Audit log is **in-memory, capped at 500 entries** (`executor.ts:39-44`). Lost on process restart.
  - **CRITICAL GAP**: `applyExecutionResults()` (`executor.ts:119-138`) — notifications and webhooks are **counted but never dispatched** ("log for now" comments at lines 131, 134).
- **Scheduler** (`src/lib/automation/scheduler.ts:1-117`): Time-based rule evaluator. Uses BullMQ repeatable job (with setInterval fallback). Runs `automation`-type rules against all active tickets on a timer.
- **Constants** (`src/lib/automation/constants.ts:1-93`): Canonical field/operator/action lists shared across UI.
- **Event Integration** (`src/lib/events/dispatcher.ts:130-137`): `evaluateAutomation()` is called on ticket events (channel 4 of dispatcher fan-out). Skips `automation.executed` to avoid loops.

### Tier 2: Visual Workflow Builder (workflow/*)
- **Types** (`src/lib/workflow/types.ts:1-107`): Directed graph model. 6 node types: trigger, state, condition, action, delay, end. Transitions with optional conditions, actions, branchKey.
- **Store** (`src/lib/workflow/store.ts:1-182`): DB + JSONL dual-path CRUD. Workflows stored in `workflows` table with `flow` JSONB column containing `{nodes, transitions, entryNodeId}`.
- **Decomposer** (`src/lib/workflow/decomposer.ts:1-342`): Converts visual workflow graphs into Rule[] via tag-based state machine. Each transition → trigger rule. State tags: `wf:{workflowId}:state:{nodeId}`. Includes validation (orphan nodes, missing transitions, incomplete branches).
- **Sync** (`src/lib/workflow/sync.ts:1-72`): Merges workflow-generated rules (prefixed `wf-`) with manual rules into the engine. Supports full sync and incremental single-workflow sync.
- **Optimizer** (`src/lib/workflow/optimizer.ts:1-229`): 5 deterministic auto-fixes: add missing end node, connect dead-ends, add default SLAs, add escalation path, fix incomplete branches.
- **Bootstrap** (`src/lib/workflow/bootstrap.ts:1-36`): Lazy-loads workflows into engine on first ticket event. Idempotent, handles concurrent callers.
- **Templates** (`src/lib/workflow/templates.ts:1-285`): 3 starter templates: Simple Lifecycle (7 nodes), Escalation Pipeline (6 nodes), SLA-Driven (5 nodes).
- **UI** (`src/app/workflows/page.tsx:1-441`): Full workflow list page with preset quick-start, create/edit/delete/export/optimize.
- **Builder** (`src/app/workflows/_components/WorkflowBuilder.tsx:1-967`): Canvas-based visual builder with drag-and-drop nodes, bezier transition curves, pan/zoom, undo stack, connection ports, validation panel, optimize preview, import/export. No external dependency (no React Flow — pure DOM+SVG).

### Tier 1 UI: Rules Page
- **Rules Page** (`src/app/rules/page.tsx:1-300`): Table list with type filter, create form (single condition + single action), toggle enable/disable, delete. Basic but functional.

### API Routes
- **Rules API** (`src/app/api/rules/route.ts:1-191`): GET (list with type filter, demo fallback), POST (create). Auth-scoped to workspace.
- **Rules CRUD** (`src/app/api/rules/[id]/route.ts:1-107`): GET, PATCH (name/enabled/conditions/actions), DELETE. All workspace-scoped.
- **Workflows API** (`src/app/api/workflows/route.ts`): GET (list), POST (create from template or blank).
- **Workflow CRUD** (`src/app/api/workflows/[id]/route.ts`): GET, PUT, DELETE.
- **Workflow Export** (`src/app/api/workflows/[id]/export/route.ts`): GET export with decomposed rules.
- **Workflow Optimize** (`src/app/api/workflows/[id]/optimize/route.ts`): POST with dryRun mode.

### MCP Tools
- **Rule tools** (`cli/mcp/tools/actions.ts`): `rule_create`, `rule_toggle` — both require confirmation. rule_create doesn't actually persist to DB (records MCP action log only).
- **Workflow tools** (`cli/mcp/tools/workflows.ts:1-234`): `workflow_list`, `workflow_create`, `workflow_get`, `workflow_toggle`, `workflow_delete`, `workflow_export` — all fully functional with DB persistence and sync.

### DB Schema
- **`rules`** (`src/db/schema.ts:433-444`): id, workspaceId, type (enum), name, enabled, conditions (JSONB), actions (JSONB), source, timestamps.
- **`automation_rules`** (`src/db/schema.ts:780-801`): id, workspaceId, name, description, conditions (JSONB), actions (JSONB), enabled, timestamps. Separate from `rules` — appears to be an older/parallel table.
- **`workflows`** (`src/db/schema.ts:1148-1165`): id, workspaceId, name, description, flow (JSONB), enabled, version, timestamps.

### Test Coverage
- `executor.test.ts`: CRUD, executeRules, dry-run audit, evaluateAutomation from event data.
- `scheduler.test.ts`: start/stop, tick evaluation, no-rules skip.
- `side-effects.test.ts`: applyExecutionResults changes, dry-run skip, notification/webhook counting.
- Workflow tests: store, decomposer, sync, optimizer — all have test files.

---

## 2. Proposed DB Schema Changes

### 2.1 New: `rule_executions` (Persistent Audit Trail)
```sql
CREATE TABLE rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  rule_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,        -- trigger/automation/sla/macro
  ticket_id TEXT NOT NULL,
  event TEXT NOT NULL,
  conditions_snapshot JSONB,      -- conditions that were evaluated
  changes JSONB NOT NULL,         -- field changes applied
  notifications JSONB,            -- notifications dispatched
  webhooks JSONB,                 -- webhooks fired
  dry_run BOOLEAN NOT NULL DEFAULT false,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rule_executions_workspace_idx ON rule_executions(workspace_id, executed_at DESC);
CREATE INDEX rule_executions_rule_idx ON rule_executions(rule_id, executed_at DESC);
CREATE INDEX rule_executions_ticket_idx ON rule_executions(ticket_id);
```

### 2.2 New: `rule_versions` (Rule Versioning)
```sql
CREATE TABLE rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  conditions JSONB,
  actions JSONB,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rule_id, version)
);
```

### 2.3 Modify: `rules` table
```sql
ALTER TABLE rules ADD COLUMN description TEXT;
ALTER TABLE rules ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rules ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN last_executed_at TIMESTAMPTZ;
ALTER TABLE rules ADD COLUMN execution_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN created_by UUID REFERENCES users(id);
```

### 2.4 Consolidate `automation_rules` → `rules`
The `automation_rules` table (schema.ts:780) appears to be a parallel/legacy table. Migrate any data to `rules` and drop `automation_rules`.

### 2.5 New: `macros` (Agent-Initiated Multi-Action Scripts)
```sql
CREATE TABLE macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  actions JSONB NOT NULL,          -- RuleAction[]
  scope TEXT NOT NULL DEFAULT 'shared',  -- 'personal' | 'shared'
  created_by UUID REFERENCES users(id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX macros_workspace_idx ON macros(workspace_id);
```

---

## 3. New API Routes Needed

### 3.1 Rule Execution Audit
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/rules/[id]/executions` | List execution history for a rule (paginated) |
| GET | `/api/rules/executions` | List all executions (filterable by rule, ticket, date range) |
| POST | `/api/rules/[id]/test` | Dry-run a rule against a specific ticket or set of tickets |
| POST | `/api/rules/[id]/test-bulk` | Preview rule against all matching tickets (returns count + sample) |

### 3.2 Macros
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/macros` | List macros (scope: personal + shared) |
| POST | `/api/macros` | Create macro |
| PATCH | `/api/macros/[id]` | Update macro |
| DELETE | `/api/macros/[id]` | Delete macro |
| POST | `/api/macros/[id]/apply` | Apply macro to a ticket (ticketId in body) |

### 3.3 Rule Versioning
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/rules/[id]/versions` | List version history |
| POST | `/api/rules/[id]/revert` | Revert to a previous version |

---

## 4. New/Modified UI Pages/Components

### 4.1 Modify: Rules Page (`src/app/rules/page.tsx`)
**Priority: HIGH** — Current form only supports 1 condition + 1 action.

- **Multi-condition builder**: Add/remove condition rows, toggle ALL/ANY logic.
- **Multi-action builder**: Add/remove action rows with type-specific value inputs.
- **Compound conditions**: Support nested condition groups (AND within OR).
- **Execution history tab**: Per-rule execution log showing last N fires with ticket links.
- **Rule ordering**: Drag-and-drop to set execution_order.
- **Rule description**: Add description field to create/edit form.
- **Dry-run button**: Test rule against existing tickets with preview results.
- **Bulk operations**: Multi-select rules for enable/disable/delete.

### 4.2 New: Macro Manager (`src/app/macros/page.tsx`)
- List personal + shared macros
- Create/edit macro with multi-action builder
- "Try it" button to test against a ticket
- Usage analytics (most-used macros)

### 4.3 Modify: Ticket Detail (`src/app/tickets/[id]/page.tsx`)
- **Macro button**: Dropdown of available macros, one-click apply
- **Rule history**: Show which rules have fired on this ticket

### 4.4 Modify: Workflow Builder (`src/app/workflows/_components/WorkflowBuilder.tsx`)
- **Send reply node type**: New node that sends a templated reply to the customer (extends action node)
- **Approval node type**: Pauses workflow and waits for agent approval before continuing
- **Minimap**: Small overview in corner for large workflows

### 4.5 New: Automation Dashboard (`src/app/automation/page.tsx`)
- Unified view of rules, workflows, and macros
- Execution analytics: rules fired per hour/day, success/failure rate
- Top rules by execution count
- Recent failures

---

## 5. New CLI Commands

### 5.1 `cliaas rules`
```
cliaas rules list [--type trigger|automation|sla|macro] [--enabled]
cliaas rules show <id>
cliaas rules create --name "..." --type trigger --conditions '...' --actions '...'
cliaas rules toggle <id>
cliaas rules delete <id>
cliaas rules test <id> --ticket <ticketId>    # dry-run
cliaas rules test <id> --all                  # bulk dry-run
cliaas rules history <id> [--limit 20]        # execution audit
```

### 5.2 `cliaas macros`
```
cliaas macros list
cliaas macros create --name "..." --actions '...'
cliaas macros apply <id> --ticket <ticketId>
cliaas macros delete <id>
```

---

## 6. New MCP Tools

### 6.1 Fix Existing
- **`rule_create`**: Currently a no-op (records MCP action log, doesn't persist). Must write to DB via `rules` table and sync into in-memory engine.
- **`rule_toggle`**: Same — must update DB and sync.

### 6.2 New Tools
| Tool | Description |
|------|-------------|
| `rule_list` | List rules with optional type filter |
| `rule_get` | Get rule details including recent execution history |
| `rule_test` | Dry-run a rule against a ticket or all matching tickets |
| `rule_delete` | Delete a rule |
| `rule_history` | Get execution audit trail for a rule |
| `macro_list` | List available macros |
| `macro_create` | Create a macro with actions |
| `macro_apply` | Apply a macro to a ticket |

---

## 7. Migration/Rollout Plan

### Phase 1: Fix Critical Gaps (must-fix) — Effort: M
1. **Persistent audit trail**: Create `rule_executions` table and migration. Replace in-memory audit log in `executor.ts` with DB writes (batch insert, fire-and-forget to avoid blocking rule evaluation).
2. **Dispatch notifications and webhooks**: Implement actual `fetch()` for webhooks and integrate with notification service for emails/Slack in `applyExecutionResults()`. Replace "for now" comments.
3. **Fix `rule_create` MCP tool**: Wire to DB persistence and in-memory engine sync.
4. **Consolidate `automation_rules` → `rules`**: Migrate data, update references, drop legacy table.

### Phase 2: Rule Engine Enhancements — Effort: M
5. **Multi-condition/multi-action rule creation UI**: Upgrade the rules page form.
6. **Compound conditions**: Support nested `{all: [{any: [...]}]}` condition groups in evaluator. The condition evaluator already supports top-level `all`+`any`, but not nesting.
7. **Rule versioning**: Create `rule_versions` table. On every PATCH to a rule, snapshot the previous version.
8. **Rule dry-run/test**: API endpoint + UI button to preview rule against existing tickets.
9. **Execution ordering**: Add `execution_order` to rules, sort in `runRules()`.

### Phase 3: Macros — Effort: S
10. **Macros table + API**: CRUD endpoints.
11. **Macro UI**: Standalone page + ticket detail integration (one-click apply dropdown).
12. **MCP macro tools**: `macro_list`, `macro_create`, `macro_apply`.

### Phase 4: Workflow Builder Enhancements — Effort: M
13. **Send reply action type**: Add `send_reply` to action types, integrate with email/chat send.
14. **Approval node**: New workflow node type that pauses execution and creates an approval request.
15. **Minimap**: Small canvas overview in workflow builder.
16. **Workflow execution tracking**: Show which workflow state a ticket is in (via `wf:*:state:*` tags) in ticket detail.

### Phase 5: Automation Dashboard — Effort: S
17. **Unified automation dashboard**: Aggregate view of rules + workflows + macros with execution analytics.
18. **Rule execution analytics**: Charts for fires/day, success rate, top rules.

### Phase 6: CLI + MCP Parity — Effort: S
19. **CLI `rules` command**: Full CRUD + test + history.
20. **CLI `macros` command**: List, create, apply.
21. **MCP tool fixes and additions**: All tools listed in section 6.

---

## 8. Effort Estimate

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 1: Fix Critical Gaps | **M** (3-5 days) | None |
| Phase 2: Rule Engine Enhancements | **M** (3-5 days) | Phase 1 |
| Phase 3: Macros | **S** (1-2 days) | Phase 1 |
| Phase 4: Workflow Builder Enhancements | **M** (3-5 days) | Phase 1 |
| Phase 5: Automation Dashboard | **S** (1-2 days) | Phases 1-3 |
| Phase 6: CLI + MCP Parity | **S** (1-2 days) | Phases 1-3 |

**Total: L** (12-20 days for all phases)

**Recommended minimum viable delivery**: Phases 1 + 2 + 3 = **M** (7-12 days). This fixes the critical "for now" gaps, adds persistent audit, makes rules production-grade, and delivers macros.

---

## Key Risks & Decisions

1. **In-memory vs DB rule loading**: Currently rules are loaded into global memory on bootstrap. With DB-persistent rules, need a cache-invalidation strategy (reload on rule change, or poll interval). Recommend: reload on write (rule create/update/delete/toggle) + bootstrap on cold start.

2. **Two tables for rules**: `rules` and `automation_rules` both exist. Decision needed: consolidate to `rules` (recommended) or keep both with clear purpose separation.

3. **Webhook/notification dispatch**: The "for now" comments suggest these were never prioritized. Webhook dispatch is straightforward (fetch + retry). Notifications need integration with the email/Slack send infrastructure that already exists in channels.

4. **Workflow state machine scalability**: The tag-based state machine (`wf:{id}:state:{nodeId}`) works but could create tag bloat on tickets that traverse many workflow states. Consider a separate `ticket_workflow_state` table instead of tags.

5. **Visual workflow builder complexity**: The existing pure DOM+SVG builder is impressive but adding complex node types (approval, reply) will increase maintenance. Consider whether React Flow is worth adopting for the node rendering layer, keeping the custom canvas for everything else.
