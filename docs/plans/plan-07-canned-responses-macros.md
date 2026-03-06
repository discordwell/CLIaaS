# Plan 07: Canned Responses, Macros & Agent Signatures

## 1. Summary of What Exists Today

### No Canned Response / Template System
CLIaaS has zero canned response, saved reply, or template functionality. Every competitor in the helpdesk space (Zendesk, Freshdesk, Intercom, Help Scout) ships canned responses as a core feature. This is a critical competitive gap.

### Existing Reply Mechanisms

- **`src/components/TicketActions.tsx`** (lines 1-165): Client component with a reply textarea, internal-note toggle, and status/priority update dropdowns. The reply form is a bare `<textarea>` with no template insertion, no canned response picker, and no signature appending. Posts to `POST /api/tickets/[id]/reply`.

- **`src/app/tickets/[id]/page.tsx`** (lines 1-207): Server component rendering ticket detail with conversation thread. Renders `<TicketActions>` at line 173. No macro button or canned response UI anywhere on this page.

- **`src/app/api/tickets/[id]/reply/route.ts`** (lines 1-95): Reply API route. Accepts `{ message, isNote }`, resolves source connector, posts to external platform. No merge variable resolution, no signature injection.

- **MCP `ticket_reply` tool** (`cli/mcp/tools/actions.ts`, lines 89-135): Accepts raw `body` string. No template lookup, no merge variable resolution.

- **MCP `draft_reply` tool** (`cli/mcp/tools/analysis.ts`, line 72): AI-generated draft reply using LLM provider. Returns plain text draft. No canned response integration.

- **CLI `cliaas draft reply`** (`cli/commands/draft.ts`, lines 1-81): Generates AI draft using LLM provider with optional RAG context. No canned response insertion.

### Existing Rules / Macros Infrastructure

- **`src/db/schema.ts`** (lines 48-53): `ruleTypeEnum` already includes `'macro'` as a valid type alongside `trigger`, `automation`, `sla`.

- **`rules` table** (`src/db/schema.ts`, lines 433-444): Generic rules table with `type` (uses `ruleTypeEnum`), `name`, `enabled`, `conditions` (JSONB), `actions` (JSONB). The `macro` type exists in the enum but is used only for imported macros from connectors (e.g., Zendesk macro imports). There is no native macro execution engine.

- **MCP `rule_create`** (`cli/mcp/tools/actions.ts`, lines 240-275): Can create a rule with `type: 'macro'`, but it only records the rule -- there is no apply/execute capability.

### Existing Settings / Agent Profile

- **`src/app/settings/page.tsx`** (lines 1-138): Settings page with connectors, LLM providers, and quick commands. No signature management section.

- **`src/components/settings/ProfileSection.tsx`** (lines 1-161): Agent profile with name edit and password change. No email signature field.

- **`src/components/settings/SettingsUserSections.tsx`** (lines 1-45): Renders `ProfileSection` and `TeamSection`. No signature section.

- **`users` table** (`src/db/schema.ts`, lines 157-178): Has `email`, `name`, `role`, `status`. No `signature` or `signatureHtml` column.

### Existing JSONL Store Pattern

- **`src/lib/jsonl-store.ts`** (lines 1-41): Generic `readJsonlFile<T>()` and `writeJsonlFile<T>()` for demo/BYOC mode persistence. New stores follow this pattern with a `global.__cliaa*` singleton.

### DataProvider Interface

- **`src/lib/data-provider/types.ts`** (lines 190-213): `DataProvider` interface defines `loadRules()` returning `RuleRecord[]`. No canned response, macro, or signature methods exist. These will need to be added.

### What's Completely Missing
- No canned responses table or store
- No macro execution engine (only import/storage)
- No agent signature storage or injection
- No merge variable resolution engine (`{{customer.name}}`, `{{ticket.id}}`, etc.)
- No canned response search/picker UI
- No macro apply button in ticket detail
- No signature settings UI
- No CLI commands for canned response management
- No MCP tools for searching/applying canned responses or macros

---

## 2. Proposed DB Schema Changes

### New Enum

```sql
-- Scope enum shared by canned_responses and macros
CREATE TYPE template_scope AS ENUM ('personal', 'shared');
```

### New Tables

```sql
-- Canned responses: reusable reply templates with merge variables
CREATE TABLE canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,               -- supports {{customer.name}}, {{ticket.id}}, etc.
  category TEXT,                     -- e.g. "Billing", "Shipping", "General"
  scope template_scope NOT NULL DEFAULT 'personal',
  shortcut TEXT,                     -- optional keyboard shortcut like "/thanks"
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX canned_responses_workspace_idx ON canned_responses(workspace_id);
CREATE INDEX canned_responses_category_idx ON canned_responses(workspace_id, category);
CREATE INDEX canned_responses_created_by_idx ON canned_responses(created_by);

-- Macros: one-click multi-action bundles
CREATE TABLE macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  actions JSONB NOT NULL DEFAULT '[]',  -- [{type: "set_status", value: "solved"}, {type: "add_tag", value: "resolved"}, ...]
  scope template_scope NOT NULL DEFAULT 'shared',
  enabled BOOLEAN NOT NULL DEFAULT true,
  usage_count INT NOT NULL DEFAULT 0,
  position INT,                          -- ordering for UI display
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX macros_workspace_idx ON macros(workspace_id);
CREATE INDEX macros_created_by_idx ON macros(created_by);

-- Agent signatures: per-agent or per-brand HTML/text signatures
CREATE TABLE agent_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),     -- NULL = workspace default
  brand_id UUID REFERENCES brands(id),   -- NULL = all brands
  name TEXT NOT NULL,                     -- e.g. "Default", "Marketing"
  body_html TEXT NOT NULL,               -- HTML signature
  body_text TEXT NOT NULL,               -- Plain text fallback
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_signatures_workspace_idx ON agent_signatures(workspace_id);
CREATE INDEX agent_signatures_user_idx ON agent_signatures(user_id);
CREATE UNIQUE INDEX agent_signatures_user_default_idx
  ON agent_signatures(user_id, brand_id) WHERE is_default = true;
```

### Macro Actions JSONB Schema

Each entry in the `actions` array is one of:

```typescript
type MacroAction =
  | { type: 'set_status'; value: TicketStatus }
  | { type: 'set_priority'; value: TicketPriority }
  | { type: 'add_tag'; value: string }
  | { type: 'remove_tag'; value: string }
  | { type: 'assign'; value: string }          // user ID or null to unassign
  | { type: 'assign_group'; value: string }     // group ID
  | { type: 'add_reply'; value: string }        // body text (supports merge vars)
  | { type: 'add_note'; value: string }         // internal note body
  | { type: 'set_custom_field'; field: string; value: unknown }
```

### No Modifications to Existing Tables

The existing `rules` table (which has `type: 'macro'` in the enum) stores imported macros from external platforms. The new `macros` table is purpose-built for native CLIaaS macros with a structured `actions` JSONB schema, enabling the execution engine. Imported macros in the `rules` table can be migrated later if needed.

---

## 3. New API Routes

### Canned Responses

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/canned-responses` | List canned responses (filter: category, scope, search query) |
| POST | `/api/canned-responses` | Create a canned response |
| GET | `/api/canned-responses/[id]` | Get a single canned response |
| PATCH | `/api/canned-responses/[id]` | Update a canned response |
| DELETE | `/api/canned-responses/[id]` | Delete a canned response |
| POST | `/api/canned-responses/[id]/resolve` | Resolve merge variables against a ticket context |

### Macros

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/macros` | List macros (filter: scope, enabled) |
| POST | `/api/macros` | Create a macro |
| GET | `/api/macros/[id]` | Get a single macro with actions |
| PATCH | `/api/macros/[id]` | Update a macro |
| DELETE | `/api/macros/[id]` | Delete a macro |
| POST | `/api/macros/[id]/apply` | Apply a macro to a ticket (executes all actions) |

### Agent Signatures

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/signatures` | List signatures (filter: user, brand) |
| POST | `/api/signatures` | Create a signature |
| GET | `/api/signatures/[id]` | Get a single signature |
| PATCH | `/api/signatures/[id]` | Update a signature |
| DELETE | `/api/signatures/[id]` | Delete a signature |

### Merge Variable Resolution

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/merge-variables` | List all available merge variables with descriptions |

**Total: 18 new API routes**

---

## 4. New/Modified UI Pages/Components

### New Component: `CannedResponsePicker`
- **File**: `src/components/CannedResponsePicker.tsx`
- Dropdown/popover triggered by a button or `/` shortcut in the reply textarea
- Search input with category filter tabs
- Shows title + truncated body preview
- On select: inserts resolved template body at cursor position in textarea
- Scope-aware: shows personal templates first, then shared

### New Component: `MacroButton`
- **File**: `src/components/MacroButton.tsx`
- Dropdown button in ticket detail showing available macros
- Each macro shows name + action summary (e.g., "Set status: solved, Add tag: resolved")
- One-click apply with confirmation toast
- Shows result summary after application

### New Component: `SignatureEditor`
- **File**: `src/components/settings/SignatureEditor.tsx`
- Rich text editor for HTML signature (or textarea for plain text)
- Live preview panel
- Brand selector (if multi-brand)
- "Set as default" toggle

### Modified: `TicketActions.tsx`
- **File**: `src/components/TicketActions.tsx`
- Add `CannedResponsePicker` button next to the reply textarea (between note toggle and send button)
- Add `MacroButton` in the "Update Ticket" section header
- Inject agent signature below reply textarea when sending (toggleable)
- Add signature toggle checkbox: "Append signature"

### Modified: Ticket Detail Page
- **File**: `src/app/tickets/[id]/page.tsx`
- Pass additional context props to `TicketActions` for merge variable resolution (customer name, ticket data)
- Add macro button in the ticket header action area

### Modified: Settings Page
- **File**: `src/app/settings/page.tsx`
- Add new "Email Signatures" section between Profile and Connectors
- Link to full signature management

### New Page: Canned Responses Management
- **File**: `src/app/settings/canned-responses/page.tsx`
- Table listing all canned responses with title, category, scope, usage count, last updated
- Create/edit modal with title, body (with merge variable autocomplete), category, scope, shortcut
- Import from connected platforms (Zendesk macros, Freshdesk canned responses)
- Merge variable reference panel showing available variables

### New Page: Macros Management
- **File**: `src/app/settings/macros/page.tsx`
- Table listing all macros with name, action count, scope, usage count
- Create/edit form with drag-and-drop action builder
- Action types: set status, set priority, add/remove tag, assign agent/group, add reply, add note
- Each action row has a type selector and a value input
- Reorder actions with drag handles
- Test/preview: select a ticket and see what the macro would do

### Modified: `ProfileSection.tsx`
- **File**: `src/components/settings/ProfileSection.tsx`
- Add "Email Signature" section below password change
- Inline signature editor for personal default signature

---

## 5. New CLI Commands

```
cliaas canned list [--category <cat>] [--scope personal|shared] [--search <query>]
cliaas canned show <id>
cliaas canned create --title <title> --body <body> [--category <cat>] [--scope personal|shared] [--shortcut <shortcut>]
cliaas canned update <id> [--title <t>] [--body <b>] [--category <c>] [--scope <s>]
cliaas canned delete <id>
cliaas canned resolve <id> --ticket <ticketId>    # resolve merge vars and print result

cliaas macro list [--scope personal|shared]
cliaas macro show <id>
cliaas macro create --name <name> --actions <json>  # JSON array of actions
cliaas macro apply <macroId> --ticket <ticketId>    # execute macro on a ticket
cliaas macro delete <id>

cliaas signature list [--user <userId>]
cliaas signature create --name <name> --body <body> [--html <html>] [--default]
cliaas signature update <id> [--name <n>] [--body <b>] [--html <h>]
cliaas signature delete <id>
```

**Registration**: New file `cli/commands/canned.ts` exporting `registerCannedCommands()`, added to `cli/commands/index.ts`.

---

## 6. New MCP Tools

| Tool | Module | Description |
|------|--------|-------------|
| `search_canned_responses` | `cli/mcp/tools/canned.ts` | Search canned responses by title, category, or body content |
| `get_canned_response` | `cli/mcp/tools/canned.ts` | Get a single canned response by ID with resolved merge variables |
| `create_canned_response` | `cli/mcp/tools/canned.ts` | Create a new canned response (requires confirm) |
| `update_canned_response` | `cli/mcp/tools/canned.ts` | Update an existing canned response (requires confirm) |
| `delete_canned_response` | `cli/mcp/tools/canned.ts` | Delete a canned response (requires confirm) |
| `resolve_template` | `cli/mcp/tools/canned.ts` | Resolve merge variables in arbitrary text against a ticket context |
| `apply_macro` | `cli/mcp/tools/canned.ts` | Apply a macro to a ticket -- executes all actions (requires confirm) |
| `list_macros` | `cli/mcp/tools/canned.ts` | List available macros with action summaries |
| `create_macro` | `cli/mcp/tools/canned.ts` | Create a new macro (requires confirm) |
| `get_signature` | `cli/mcp/tools/canned.ts` | Get the active signature for an agent/brand |

**Registration**: New module `cli/mcp/tools/canned.ts` exporting `registerCannedTools()`, registered in `cli/mcp/server.ts`.

**Total: 10 new MCP tools** (60 existing + 10 = 70)

### Key MCP Tool Signatures

```typescript
// search_canned_responses
{
  query: z.string().optional(),
  category: z.string().optional(),
  scope: z.enum(['personal', 'shared']).optional(),
  limit: z.number().default(10),
}

// apply_macro
{
  macroId: z.string(),
  ticketId: z.string(),
  confirm: z.boolean().optional(),  // confirmation pattern
  dir: z.string().optional(),
}

// resolve_template
{
  text: z.string(),
  ticketId: z.string(),
  dir: z.string().optional(),
}
```

---

## 7. Migration / Rollout Plan

### Phase 1: Foundation -- Schema + Stores + Merge Engine (2-3 days)

1. **Migration file**: `src/db/migrations/0006_canned_responses_macros.sql`
   - Create `template_scope` enum
   - Create `canned_responses`, `macros`, `agent_signatures` tables with all indexes
   - Add RLS policies for workspace isolation

2. **Drizzle schema**: Add tables to `src/db/schema.ts` (3 new table definitions + 1 new enum)

3. **JSONL stores** for demo/BYOC mode:
   - `src/lib/canned/canned-store.ts` -- in-memory + JSONL for canned responses
   - `src/lib/canned/macro-store.ts` -- in-memory + JSONL for macros
   - `src/lib/canned/signature-store.ts` -- in-memory + JSONL for signatures

4. **Merge variable engine**: `src/lib/canned/merge.ts`
   - `resolveMergeVariables(template: string, context: MergeContext): string`
   - Supported variables:
     - `{{customer.name}}`, `{{customer.email}}`, `{{customer.phone}}`
     - `{{ticket.id}}`, `{{ticket.subject}}`, `{{ticket.status}}`, `{{ticket.priority}}`
     - `{{ticket.external_id}}`, `{{ticket.created_at}}`
     - `{{agent.name}}`, `{{agent.email}}`
     - `{{workspace.name}}`
   - Regex-based replacement with graceful fallback for missing values (empty string or `[unknown]`)
   - Unit tests for all variable types, nested contexts, and edge cases

5. **DataProvider additions**: Add to the `DataProvider` interface in `src/lib/data-provider/types.ts`:
   - `loadCannedResponses(opts?: { category?: string; scope?: string }): Promise<CannedResponse[]>`
   - `loadMacros(opts?: { scope?: string }): Promise<Macro[]>`
   - `loadSignatures(opts?: { userId?: string }): Promise<AgentSignature[]>`
   - Implement in all 4 providers (jsonl, db, remote, hybrid)

6. **Tests**: Unit tests for merge engine, store CRUD operations

### Phase 2: Macro Execution Engine (1-2 days)

7. **Macro executor**: `src/lib/canned/macro-executor.ts`
   - `executeMacro(macro: Macro, ticketId: string, context: MergeContext): Promise<MacroResult>`
   - Processes actions sequentially: set_status, set_priority, add_tag, remove_tag, assign, add_reply, add_note, set_custom_field
   - Each action maps to existing DataProvider write methods
   - Returns `MacroResult` with list of applied actions + any errors
   - Merge variables resolved in `add_reply` and `add_note` action values
   - Fires `ticket.updated` and `message.created` events as appropriate
   - Increments `usage_count` on successful execution

8. **Tests**: Macro execution with various action combinations, error handling for partial failures

### Phase 3: API Routes (1-2 days)

9. **Canned response routes**: `src/app/api/canned-responses/` (6 routes)
   - Standard CRUD with workspace scoping
   - `POST .../[id]/resolve` accepts `{ ticketId }` and returns resolved body
   - Scope filtering: personal responses require `created_by` match

10. **Macro routes**: `src/app/api/macros/` (6 routes)
    - Standard CRUD with workspace scoping
    - `POST .../[id]/apply` accepts `{ ticketId }`, runs macro executor, returns result

11. **Signature routes**: `src/app/api/signatures/` (5 routes)
    - Standard CRUD with workspace scoping
    - GET supports `?user=me` shorthand

12. **Merge variables route**: `GET /api/merge-variables` returns variable catalog with descriptions

13. **Tests**: API integration tests for all 18 routes

### Phase 4: CLI + MCP (1-2 days)

14. **CLI commands**: `cli/commands/canned.ts`
    - All 15 subcommands as specified in Section 5
    - Follows existing patterns from `cli/commands/campaigns.ts` and `cli/commands/tickets.ts`
    - Register in `cli/commands/index.ts`

15. **MCP tools**: `cli/mcp/tools/canned.ts`
    - All 10 tools as specified in Section 6
    - Uses existing confirmation pattern from `cli/mcp/tools/actions.ts`
    - Register in `cli/mcp/server.ts`

16. **Modify `ticket_reply` MCP tool** (`cli/mcp/tools/actions.ts`):
    - Add optional `cannedResponseId` parameter
    - Add optional `appendSignature` boolean parameter
    - If `cannedResponseId` provided, look up template and resolve merge variables before sending

17. **Tests**: MCP tool unit tests

### Phase 5: UI (2-3 days)

18. **CannedResponsePicker component**: `src/components/CannedResponsePicker.tsx`
    - Fetches from `GET /api/canned-responses`
    - Inline search + category tabs
    - Calls resolve endpoint to get final text
    - Inserts into parent textarea via callback

19. **MacroButton component**: `src/components/MacroButton.tsx`
    - Fetches from `GET /api/macros`
    - Dropdown with action summaries
    - Calls `POST /api/macros/[id]/apply` on click
    - Shows success/error toast

20. **Modify TicketActions**: Integrate CannedResponsePicker and MacroButton

21. **SignatureEditor component**: `src/components/settings/SignatureEditor.tsx`
    - Textarea for HTML and plain text
    - Preview panel
    - Save to `POST /api/signatures`

22. **Settings pages**: Canned response management page + macro management page

23. **Modify ProfileSection**: Add inline signature editor

24. **Tests**: Component tests for picker, macro button

### Phase 6: Polish + Demo Data (1 day)

25. **Demo data**: Add canned responses and macros to `cliaas demo generate`
    - 5 sample canned responses (greeting, escalation, billing, shipping, closing)
    - 3 sample macros (close-and-tag, escalate-to-tier-2, acknowledge-receipt)
    - 2 sample signatures

26. **Update ARCHITECTURE.md**: Add new tables to schema section, new tools to MCP section, new commands to CLI section, new routes to API count

27. **Update feature gate matrix**: Add `canned_responses` feature flag (available on all tiers -- this is a core feature, not premium)

---

## 8. Effort Estimate

**Overall: M (Medium)**

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1: Foundation | Schema, stores, merge engine | 2-3 days |
| Phase 2: Macro Engine | Execution logic + tests | 1-2 days |
| Phase 3: API Routes | 18 routes + tests | 1-2 days |
| Phase 4: CLI + MCP | 15 commands, 10 tools | 1-2 days |
| Phase 5: UI | 3 new components, 2 pages, mods | 2-3 days |
| Phase 6: Polish | Demo data, docs, gates | 1 day |
| **Total** | | **8-13 days** |

### Risk Factors
- **Low risk**: Schema and stores are straightforward CRUD -- follows well-established patterns in the codebase
- **Medium risk**: Macro execution engine needs careful error handling for partial action failures and event propagation
- **Low risk**: Merge variable engine is a simple regex replacement -- no external dependencies
- **Low risk**: UI components are self-contained dropdowns/pickers, not major page overhauls

### Dependencies
- None. This feature is entirely additive with no breaking changes to existing functionality.
- The existing `ruleTypeEnum` already includes `'macro'` so there are no enum conflicts.
- The merge variable engine is new code with no external service dependencies.

### Competitive Parity Achieved
After implementation, CLIaaS will have feature parity with:
- **Zendesk macros**: Multi-action one-click bundles (set fields + add reply + assign + tag)
- **Freshdesk canned responses**: Categorized templates with merge variables
- **Help Scout saved replies**: Template search + insert with variable resolution
- **Intercom saved replies**: Quick insertion with customer context variables

The CLIaaS advantage: all of the above are also available as MCP tools, enabling AI agents to search for and apply the right canned response or macro without human intervention.
