# Plan 18: Visual No-Code Chatbot Flow Builder

**Status:** Draft
**Created:** 2026-03-06
**Effort:** XL (6-8 weeks)
**Dependencies:** None (all prerequisites exist)

---

## 1. What Exists Today

CLIaaS has a functional chatbot system with a basic tree-based flow builder, a runtime engine, and chat widget integration. Here is what is in place:

### 1.1 Data Model

- **DB table:** `chatbots` with `id`, `workspaceId`, `name`, `flow` (JSONB blob containing `nodes` + `rootNodeId`), `enabled`, `greeting`, `createdAt`, `updatedAt` — `src/db/schema.ts:1103-1121`
- **TypeScript types:** `ChatbotFlow`, `ChatbotNode`, `ChatbotSessionState`, `BotResponse` — `src/lib/chatbot/types.ts:1-108`
- **5 node types:** `message`, `buttons`, `branch`, `action`, `handoff` — `src/lib/chatbot/types.ts:11`
- **4 action types:** `set_tag`, `create_ticket`, `assign`, `close` — `src/lib/chatbot/types.ts:39`
- **3 branch fields:** `message`, `email`, `name` — `src/lib/chatbot/types.ts:34`

### 1.2 Runtime Engine

- **Runtime:** `src/lib/chatbot/runtime.ts` — Pure function `evaluateBotResponse()` that walks the flow tree. Supports chaining (message/action auto-advance), loop detection (max depth 20), branch condition evaluation (contains, equals, starts_with, ends_with, matches regex), button matching (case-insensitive).
- **Session state:** `ChatbotSessionState` with `flowId`, `currentNodeId`, `visitedNodes`, `variables` — stored on `ChatSession.botState` in `src/lib/chat.ts:32`
- **Initial greeting:** `processInitialGreeting()` walks from root until user input needed — `src/lib/chatbot/runtime.ts:176-180`
- **Tests:** 15 tests covering all node types, edge cases — `src/lib/chatbot/__tests__/runtime.test.ts`

### 1.3 Storage

- **Dual-mode store:** `src/lib/chatbot/store.ts` — DB-first with JSONL fallback. CRUD: `getChatbots()`, `getChatbot()`, `getActiveChatbot()`, `upsertChatbot()`, `deleteChatbot()`
- **JSONL file:** `chatbots.jsonl`
- **Tests:** 8 tests — `src/lib/chatbot/__tests__/store.test.ts`

### 1.4 API Routes

- `GET /api/chatbots` — list all flows — `src/app/api/chatbots/route.ts:13-19`
- `POST /api/chatbots` — create a flow — `src/app/api/chatbots/route.ts:24-71`
- `GET /api/chatbots/:id` — get single flow — `src/app/api/chatbots/[id]/route.ts:13-27`
- `PUT /api/chatbots/:id` — update flow — `src/app/api/chatbots/[id]/route.ts:32-78`
- `DELETE /api/chatbots/:id` — delete flow — `src/app/api/chatbots/[id]/route.ts:83-97`
- All routes use `requireAuth` + `parseJsonBody`.

### 1.5 Chat Integration

- **Chat API:** `POST /api/chat` handles session creation, messaging, typing, close — `src/app/api/chat/route.ts`
- **Bot integration:** On session create, loads active chatbot flow and sends initial greeting (`route.ts:109-124`). On customer message, evaluates bot response and sends reply (`route.ts:177-225`).
- **Bot actions execution:** `set_tag` stores as variable, `close` closes session, handoff clears bot state — `route.ts:199-219`
- **Chat session store:** `src/lib/chat.ts` — in-memory Map with JSONL persistence, global singleton pattern.

### 1.6 UI

- **Chatbots page:** `src/app/chatbots/page.tsx` (1,227 LOC) — contains:
  - Flow list view with enable/disable toggle, edit, delete
  - New flow form with name + greeting input
  - `FlowBuilder` component: tree-based editor (NOT visual canvas), node palette, recursive `NodeTree` rendering, `NodeEditor` panel, inline preview/test
  - 5 node-type-specific editors: `MessageEditor`, `ButtonsEditor`, `BranchEditor`, `ActionEditor`, `HandoffEditor`
  - Preview/test: walks the flow in a simulated chat window with bot/customer messages and clickable buttons
- **Chat embed widget:** `src/app/chat/embed/page.tsx` — customer-facing chat with bot message rendering, button chips for bot options
- **Agent console:** `src/app/chat/page.tsx` — agent-side live chat dashboard

### 1.7 MCP Tools

- 4 chatbot tools in `cli/mcp/tools/chatbots.ts`: `chatbot_list`, `chatbot_create`, `chatbot_toggle`, `chatbot_delete`

### 1.8 What Does NOT Exist

| Capability | Status |
|------------|--------|
| Visual drag-and-drop canvas | Missing — current builder is a tree list, not a spatial graph |
| AI response node | Missing — no LLM-powered node type |
| Article suggestion node | Missing — no KB integration in chatbot flows |
| Flow versioning / draft-publish | Missing — single live version only |
| Per-flow analytics | Missing — no completion rate, drop-off, handoff tracking |
| Multi-channel deployment config | Missing — single active chatbot for all channels |
| Flow execution API (external) | Missing — bot runs only via `/api/chat` internally |
| Conversation session persistence (DB) | Missing — sessions are in-memory only |
| Node position data | Missing — `ChatbotNode` has no `position` field (contrast: `WorkflowNode` has `{x, y}`) |

### 1.9 Comparison: Workflow Builder (Existing Pattern)

The workflows system (`src/lib/workflow/`) already has a graph-based data model with positions that can inform this work:
- `WorkflowNode` has a `position: { x: number; y: number }` field — `src/lib/workflow/types.ts:68-69`
- `WorkflowTransition` models edges with from/to/conditions — `src/lib/workflow/types.ts:73-82`
- Separate `nodes` (map) + `transitions` (array) storage pattern
- Versioning with `version: integer` field — `src/db/schema.ts:1134`

---

## 2. Proposed DB Schema Changes

### 2.1 Modify Existing: `chatbots` Table

Add columns to support versioning, multi-channel deployment, and analytics:

```sql
ALTER TABLE chatbots
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN status text NOT NULL DEFAULT 'draft',           -- 'draft' | 'published' | 'archived'
  ADD COLUMN published_flow jsonb,                            -- snapshot of flow at publish time
  ADD COLUMN published_at timestamptz,
  ADD COLUMN channels text[] NOT NULL DEFAULT '{"chat"}',     -- deployment channels
  ADD COLUMN description text;
```

### 2.2 New Table: `chatbot_versions`

Track historical versions for rollback:

```sql
CREATE TABLE chatbot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id uuid NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  version integer NOT NULL,
  flow jsonb NOT NULL,                  -- full node map + rootNodeId snapshot
  name text NOT NULL,
  greeting text,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id),
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chatbot_versions_chatbot_idx ON chatbot_versions(chatbot_id, version DESC);
```

### 2.3 New Table: `chatbot_sessions`

Persist conversation sessions to the database (currently only in-memory):

```sql
CREATE TABLE chatbot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  chatbot_id uuid REFERENCES chatbots(id),
  customer_email text,
  customer_name text,
  channel text NOT NULL DEFAULT 'chat',          -- chat, portal, sdk, whatsapp, etc.
  status text NOT NULL DEFAULT 'active',          -- active, completed, abandoned, handed_off
  flow_state jsonb,                               -- ChatbotSessionState snapshot
  variables jsonb NOT NULL DEFAULT '{}',          -- collected data during flow
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  handed_off_at timestamptz,
  node_path text[] NOT NULL DEFAULT '{}',         -- ordered list of visited node IDs
  ticket_id uuid REFERENCES tickets(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chatbot_sessions_workspace_status_idx ON chatbot_sessions(workspace_id, status);
CREATE INDEX chatbot_sessions_chatbot_idx ON chatbot_sessions(chatbot_id, created_at DESC);
```

### 2.4 New Table: `chatbot_analytics`

Per-node analytics aggregation:

```sql
CREATE TABLE chatbot_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  chatbot_id uuid NOT NULL REFERENCES chatbots(id),
  node_id text NOT NULL,
  period date NOT NULL,                           -- daily aggregation
  entered_count integer NOT NULL DEFAULT 0,       -- times flow entered this node
  exited_count integer NOT NULL DEFAULT 0,        -- times flow left this node
  dropped_count integer NOT NULL DEFAULT 0,       -- abandoned at this node
  avg_time_ms integer,                            -- avg time spent at this node
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chatbot_id, node_id, period)
);

CREATE INDEX chatbot_analytics_chatbot_period_idx ON chatbot_analytics(chatbot_id, period DESC);
```

### 2.5 Update `ChatbotNode` Type (TypeScript)

Add position data and new node types:

```typescript
export type ChatbotNodeType =
  | 'message'       // existing
  | 'buttons'       // existing
  | 'branch'        // existing
  | 'action'        // existing
  | 'handoff'       // existing
  | 'ai_response'   // NEW: invoke LLM with RAG context
  | 'article_suggest' // NEW: search KB and suggest articles
  | 'collect_input' // NEW: ask for specific input (email, name, etc.)
  | 'webhook'       // NEW: call external URL
  | 'delay';        // NEW: wait N seconds before continuing

export interface ChatbotNode {
  id: string;
  type: ChatbotNodeType;
  data: ChatbotNodeData;
  children?: string[];
  position: { x: number; y: number };  // NEW: canvas coordinates
}
```

### 2.6 New Node Data Types

```typescript
export interface AiResponseNodeData {
  systemPrompt?: string;        // custom system prompt
  useRag: boolean;              // whether to search KB for context
  ragCollections?: string[];    // specific KB collections to search
  maxTokens?: number;           // response length limit
  fallbackNodeId?: string;      // node to go to if AI fails
}

export interface ArticleSuggestNodeData {
  query?: string;               // static query or use customer message
  maxArticles: number;          // max articles to suggest (default 3)
  noResultsNodeId?: string;     // fallback when no articles found
}

export interface CollectInputNodeData {
  prompt: string;               // what to ask the customer
  variableName: string;         // store response as variable
  validation?: 'email' | 'phone' | 'number' | 'none';
  errorMessage?: string;        // shown on validation failure
}

export interface WebhookNodeData {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  bodyTemplate?: string;        // template with {{variable}} substitution
  responseVariable?: string;    // store response in variable
  timeoutMs?: number;
  failureNodeId?: string;
}

export interface DelayNodeData {
  seconds: number;
}
```

---

## 3. New API Routes

### 3.1 Flow Versioning

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/chatbots/:id/publish` | Publish current draft as a new version |
| `POST` | `/api/chatbots/:id/rollback` | Rollback to a specific version |
| `GET` | `/api/chatbots/:id/versions` | List all versions of a flow |
| `GET` | `/api/chatbots/:id/versions/:version` | Get a specific version snapshot |

### 3.2 Flow Execution (External)

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/chatbots/:id/execute` | Start a flow execution session (returns session ID + initial bot response) |
| `POST` | `/api/chatbots/:id/execute/:sessionId` | Send a message to an active flow session (returns bot response) |
| `GET` | `/api/chatbots/:id/execute/:sessionId` | Get current session state |

### 3.3 Analytics

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/chatbots/:id/analytics` | Get per-node analytics (completion, drop-off, handoff rates) |
| `GET` | `/api/chatbots/:id/analytics/summary` | Get flow-level summary (total sessions, completion rate, avg duration) |

### 3.4 AI Node Support

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/chatbots/ai-respond` | Generate an AI response given context + customer message (used by AI response node runtime) |

### 3.5 Testing

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/chatbots/:id/test` | Start a sandbox test session (does not persist analytics, does not create tickets) |

**Total new routes: 9**

---

## 4. New/Modified UI Pages & Components

### 4.1 New: Visual Flow Canvas (`src/app/chatbots/builder/[id]/page.tsx`)

Replace the current tree-based `FlowBuilder` with a full drag-and-drop canvas using **@xyflow/react** (React Flow v12):

**New dependency:** `@xyflow/react` (~45KB gzipped, MIT license, industry standard)

#### Canvas Components

| Component | File | Purpose |
|-----------|------|---------|
| `FlowCanvas` | `src/components/chatbot/FlowCanvas.tsx` | Main React Flow canvas with drag-drop, zoom, pan |
| `NodePalette` | `src/components/chatbot/NodePalette.tsx` | Sidebar with draggable node type icons |
| `ChatbotNode` | `src/components/chatbot/nodes/ChatbotNode.tsx` | Base custom node renderer with handles |
| `MessageNode` | `src/components/chatbot/nodes/MessageNode.tsx` | Message node visual |
| `ButtonsNode` | `src/components/chatbot/nodes/ButtonsNode.tsx` | Buttons node with per-option output handles |
| `BranchNode` | `src/components/chatbot/nodes/BranchNode.tsx` | Condition branch with yes/no/fallback handles |
| `ActionNode` | `src/components/chatbot/nodes/ActionNode.tsx` | Action node visual |
| `HandoffNode` | `src/components/chatbot/nodes/HandoffNode.tsx` | Terminal handoff node |
| `AiResponseNode` | `src/components/chatbot/nodes/AiResponseNode.tsx` | AI response node with RAG config |
| `ArticleSuggestNode` | `src/components/chatbot/nodes/ArticleSuggestNode.tsx` | KB article suggestion node |
| `CollectInputNode` | `src/components/chatbot/nodes/CollectInputNode.tsx` | Input collection node |
| `WebhookNode` | `src/components/chatbot/nodes/WebhookNode.tsx` | Webhook call node |
| `DelayNode` | `src/components/chatbot/nodes/DelayNode.tsx` | Delay node |
| `NodeDetailPanel` | `src/components/chatbot/NodeDetailPanel.tsx` | Right sidebar: edit selected node properties |
| `FlowToolbar` | `src/components/chatbot/FlowToolbar.tsx` | Top bar: save, publish, test, back, version selector |
| `TestChatPanel` | `src/components/chatbot/TestChatPanel.tsx` | Slide-out sandbox chat for testing the flow |
| `AnalyticsOverlay` | `src/components/chatbot/AnalyticsOverlay.tsx` | Toggle overlay showing per-node metrics on canvas |
| `VersionHistory` | `src/components/chatbot/VersionHistory.tsx` | Drawer listing flow versions with rollback |

#### Canvas Behavior

- **Drag from palette:** Drag a node type from `NodePalette` onto canvas. Node created at drop position.
- **Connect nodes:** Drag from output handle to input handle to create an edge. Buttons nodes have one output handle per option. Branch nodes have per-condition handles + fallback.
- **Select and edit:** Click a node to open `NodeDetailPanel` on the right.
- **Delete:** Select a node or edge and press Delete/Backspace, or use context menu.
- **Undo/Redo:** Ctrl+Z / Ctrl+Shift+Z with state history stack.
- **Auto-layout:** Button to auto-arrange nodes using dagre layout algorithm.
- **Minimap:** React Flow minimap for navigation on large flows.
- **Zoom controls:** Fit view, zoom in/out buttons.

### 4.2 Modified: Chatbots List Page (`src/app/chatbots/page.tsx`)

- Add status badge (Draft / Published / Archived) per flow
- Add version number display
- Add channel deployment indicators (chat, portal, SDK, etc.)
- Add "Duplicate" action
- Add "Analytics" link per flow
- Replace inline tree builder with redirect to `/chatbots/builder/[id]`

### 4.3 New: Flow Analytics Page (`src/app/chatbots/[id]/analytics/page.tsx`)

- Flow-level summary cards: total sessions, completion rate, avg duration, handoff rate
- Per-node funnel visualization: bar chart showing drop-off at each node
- Time-series chart: sessions over time
- Node heatmap: overlay completion percentages on a read-only flow diagram

### 4.4 Modified: Chat Embed Widget (`src/app/chat/embed/page.tsx`)

- Support rendering new node types (AI response, article suggestions with clickable links, collect input with validation feedback)
- Display article suggestion cards with title + excerpt + link

### 4.5 Modified: Agent Console (`src/app/chat/page.tsx`)

- Show which chatbot flow is active on a session
- Show flow position indicator (which node the customer is at)
- Show handoff context (variables collected during flow)

---

## 5. New CLI Commands

### 5.1 `cliaas chatbot` Command Group

Extend the existing MCP chatbot tools with CLI equivalents:

| Command | Purpose |
|---------|---------|
| `cliaas chatbot list` | List all chatbot flows with status/version |
| `cliaas chatbot show <id>` | Show flow details (nodes, edges, version) |
| `cliaas chatbot create --name <n> [--template <t>]` | Create flow from template or blank |
| `cliaas chatbot publish <id>` | Publish draft as new version |
| `cliaas chatbot rollback <id> --version <n>` | Rollback to specific version |
| `cliaas chatbot test <id>` | Interactive CLI chat session to test a flow |
| `cliaas chatbot analytics <id>` | Show flow analytics summary |
| `cliaas chatbot export <id>` | Export flow as JSON |
| `cliaas chatbot import <file>` | Import flow from JSON file |
| `cliaas chatbot delete <id>` | Delete a flow |

**New file:** `cli/commands/chatbot.ts`

---

## 6. New MCP Tools

Add to `cli/mcp/tools/chatbots.ts`:

| Tool | Description |
|------|-------------|
| `chatbot_get` | Get full flow details including nodes and edges |
| `chatbot_publish` | Publish current draft flow as a new version |
| `chatbot_rollback` | Rollback to a specific version number |
| `chatbot_versions` | List all versions of a chatbot flow |
| `chatbot_test` | Start a test session and get initial bot response |
| `chatbot_test_respond` | Send a message to a test session and get bot response |
| `chatbot_analytics` | Get flow analytics (completion rate, drop-off points, handoff rate) |
| `chatbot_export` | Export a flow as JSON |
| `chatbot_import` | Import a flow from JSON |
| `chatbot_duplicate` | Duplicate an existing flow |

**Total new MCP tools: 10** (existing: 4, new total: 14)

---

## 7. Implementation Plan

### Phase 1: Data Model + New Node Types (Week 1)

**Goal:** Extend the chatbot data model to support canvas positioning, new node types, and versioning.

1. Add `position` field to `ChatbotNode` type in `src/lib/chatbot/types.ts`
2. Add new node type definitions (`ai_response`, `article_suggest`, `collect_input`, `webhook`, `delay`)
3. DB migration: add `version`, `status`, `published_flow`, `published_at`, `channels`, `description` columns to `chatbots` table
4. DB migration: create `chatbot_versions`, `chatbot_sessions`, `chatbot_analytics` tables
5. Update `src/db/schema.ts` with new table definitions
6. Update `src/lib/chatbot/store.ts` to handle new fields
7. Add version management functions: `publishChatbot()`, `rollbackChatbot()`, `getChatbotVersions()`
8. Write migration SQL: `src/db/migrations/0006_chatbot_visual_builder.sql`
9. Tests for new store functions

**Deliverables:** Migration file, updated types, updated store with version management

### Phase 2: Runtime Engine Enhancements (Week 2)

**Goal:** Extend the runtime engine to handle new node types.

1. Add `collect_input` node handler to runtime (prompt, validate, store variable)
2. Add `delay` node handler (returns delay instruction to client)
3. Add `ai_response` node handler:
   - Import RAG search from `cli/rag/retriever.ts`
   - Import LLM provider from `cli/providers/`
   - Build context from session variables + RAG results
   - Generate response, handle fallback on failure
4. Add `article_suggest` node handler:
   - Search KB articles using existing `src/lib/kb.ts` or RAG
   - Return formatted article suggestions
   - Handle no-results fallback
5. Add `webhook` node handler:
   - HTTP fetch with timeout, SSRF prevention (reuse `src/lib/security/`)
   - Template variable substitution in body
   - Store response in variable
   - Handle failure fallback
6. Update `evaluateBotResponse()` to handle all new node types
7. Write comprehensive tests for each new node type
8. Update `src/app/api/chat/route.ts` to handle new runtime responses (delays, article suggestions, AI responses)

**Deliverables:** Extended runtime engine, updated chat API, 20+ new tests

### Phase 3: Visual Canvas Builder (Weeks 3-4)

**Goal:** Build the drag-and-drop visual flow editor.

1. Install `@xyflow/react` dependency
2. Create `src/components/chatbot/` directory with all canvas components
3. Build `FlowCanvas` with React Flow integration:
   - Custom node types registered for all 10 node types
   - Custom edge type with delete button
   - Drag-from-palette to create nodes
   - Connection validation (prevent invalid connections)
   - Undo/redo with state history
   - Auto-layout with dagre
   - Minimap + zoom controls
4. Build `NodePalette` with all 10 node types as draggable items
5. Build `NodeDetailPanel` with type-specific editors (migrate existing editors from `page.tsx`)
6. Build `FlowToolbar` with save/publish/test/version controls
7. Build per-node-type visual components (each with appropriate handles, icons, preview text)
8. Create builder page at `src/app/chatbots/builder/[id]/page.tsx`
9. Serialize/deserialize between React Flow format and `ChatbotFlow` format
10. Update chatbots list page to link to new builder

**Deliverables:** Full visual builder page, 18 new components

### Phase 4: Testing & Preview (Week 5)

**Goal:** In-builder flow testing and sandbox chat.

1. Build `TestChatPanel` slide-out component:
   - Simulated chat window within the builder
   - Runs flow in sandbox mode (no persistence, no ticket creation)
   - Shows bot messages, button options, article suggestions, AI responses
   - Shows flow position on canvas (highlight current node during test)
   - Reset/restart button
2. Create test API routes: `POST /api/chatbots/:id/test`
3. Add node highlighting on canvas during test execution
4. Build `VersionHistory` drawer:
   - List all published versions
   - Diff view between versions (added/removed/modified nodes)
   - One-click rollback
5. Create version API routes

**Deliverables:** Test panel, version management UI, 5 new API routes

### Phase 5: Analytics (Week 6)

**Goal:** Track and display per-flow and per-node analytics.

1. Instrument the runtime engine to emit analytics events:
   - Node entered, node exited, session completed, session abandoned, handoff triggered
2. Build analytics aggregation:
   - Background job or inline aggregation to `chatbot_analytics` table
   - Daily roll-up of per-node metrics
3. Create analytics API routes: `GET /api/chatbots/:id/analytics`, `GET /api/chatbots/:id/analytics/summary`
4. Build analytics page at `src/app/chatbots/[id]/analytics/page.tsx`:
   - Summary cards (total sessions, completion %, avg duration, handoff %)
   - Funnel chart showing drop-off per node
   - Time-series chart
5. Build `AnalyticsOverlay` for the canvas:
   - Toggle button on canvas toolbar
   - Shows completion percentage badge on each node
   - Color-coded nodes by performance (green = high completion, red = high drop-off)
6. Persist `chatbot_sessions` to DB instead of in-memory only

**Deliverables:** Analytics pipeline, analytics page, canvas overlay

### Phase 6: Multi-Channel + CLI/MCP + Polish (Week 7-8)

**Goal:** Multi-channel deployment, CLI commands, MCP tools, polish.

1. Multi-channel deployment:
   - Channel selector on chatbot settings (chat widget, portal, SDK, messaging channels)
   - Update `getActiveChatbot()` to accept a channel parameter
   - Update chat widget, portal, and SDK to use channel-specific chatbot selection
2. CLI commands:
   - Create `cli/commands/chatbot.ts` with all commands from Section 5
   - Register in `cli/commands/index.ts`
3. MCP tools:
   - Add 10 new tools to `cli/mcp/tools/chatbots.ts`
   - Update MCP server registration
4. Export/Import:
   - JSON export format with schema version
   - Import with conflict detection (duplicate node IDs)
5. Templates:
   - Pre-built flow templates: "Sales Router", "Support Triage", "FAQ Bot", "Lead Qualifier"
   - Template selector in new flow creation
6. Polish:
   - Keyboard shortcuts (Ctrl+S save, Ctrl+Z undo, Delete remove node)
   - Drag-select multiple nodes
   - Copy/paste nodes
   - Connection preview animation
   - Responsive layout for smaller screens
7. Update `ARCHITECTURE.md` with chatbot builder documentation
8. Update feature gates if chatbot builder should be tier-gated

**Deliverables:** Multi-channel support, CLI commands, MCP tools, templates, polish

---

## 8. Migration / Rollout Plan

### 8.1 Database Migration

1. **Migration file:** `src/db/migrations/0006_chatbot_visual_builder.sql`
2. **Non-breaking:** All new columns have defaults; existing flows continue to work
3. **Data migration:** Existing flows need `position` data backfilled:
   - Write a one-time script that auto-layouts existing flow nodes using dagre
   - Existing flows get `status: 'published'`, `version: 1`, `published_flow` = current `flow`
4. **Rollback-safe:** New tables can be dropped without affecting existing functionality

### 8.2 Feature Flag

- Add `'chatbot_builder'` to the Feature type in `src/lib/features/gates.ts`
- Initially gate behind all tiers (available to everyone including BYOC)
- AI response node gated separately: requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

### 8.3 Deployment Sequence

1. Deploy migration (DB schema changes)
2. Deploy backend (new API routes, runtime changes) — backward compatible
3. Deploy frontend (new builder UI) — old builder still accessible as fallback
4. Run data migration script to backfill positions on existing flows
5. Smoke test on production
6. Remove old tree-based builder code (or keep as a fallback for 2 weeks)

### 8.4 Breaking Changes

- **None for API consumers.** Existing `POST /api/chatbots` and `PUT /api/chatbots/:id` continue to work. The `position` field on nodes is optional during the transition period (auto-positioned if missing).
- **ChatbotNode type change:** Adding `position` field. All consumers that create `ChatbotNode` objects need to include position. The MCP `chatbot_create` tool's `nodes` JSON parameter gains optional position data.

---

## 9. Effort Estimate

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1: Data Model | Types, migrations, store | S (3-4 days) |
| Phase 2: Runtime Engine | 5 new node handlers, tests | M (4-5 days) |
| Phase 3: Visual Canvas | React Flow integration, 18 components | XL (8-10 days) |
| Phase 4: Testing & Preview | Test panel, version management | M (4-5 days) |
| Phase 5: Analytics | Pipeline, page, overlay | M (4-5 days) |
| Phase 6: Multi-Channel + CLI/MCP | CLI, MCP, templates, polish | L (6-7 days) |

**Overall: XL (6-8 weeks)**

The visual canvas (Phase 3) is the largest single effort and the core differentiator. It requires custom React Flow node renderers for each of the 10 node types, a serialization layer between React Flow's internal format and the `ChatbotFlow` data model, drag-from-palette support, undo/redo, and auto-layout.

### Risk Factors

| Risk | Mitigation |
|------|------------|
| React Flow bundle size | Tree-shake unused features; lazy-load builder page |
| AI response latency in flow | Show typing indicator during LLM call; set timeout with fallback node |
| Canvas performance with large flows | React Flow handles 1000+ nodes; implement viewport culling |
| Undo/redo complexity | Use immutable state snapshots (immer or structuredClone) |
| SSRF via webhook nodes | Reuse existing SSRF prevention from `src/lib/security/` |

---

## 10. File Inventory

### Files to Create

| File | Purpose |
|------|---------|
| `src/db/migrations/0006_chatbot_visual_builder.sql` | DB migration |
| `src/app/chatbots/builder/[id]/page.tsx` | Visual builder page |
| `src/app/chatbots/[id]/analytics/page.tsx` | Analytics page |
| `src/components/chatbot/FlowCanvas.tsx` | Main canvas component |
| `src/components/chatbot/NodePalette.tsx` | Draggable node palette |
| `src/components/chatbot/NodeDetailPanel.tsx` | Node property editor |
| `src/components/chatbot/FlowToolbar.tsx` | Save/publish/test toolbar |
| `src/components/chatbot/TestChatPanel.tsx` | In-builder test chat |
| `src/components/chatbot/AnalyticsOverlay.tsx` | Analytics on canvas |
| `src/components/chatbot/VersionHistory.tsx` | Version drawer |
| `src/components/chatbot/nodes/ChatbotNode.tsx` | Base node renderer |
| `src/components/chatbot/nodes/MessageNode.tsx` | Message node |
| `src/components/chatbot/nodes/ButtonsNode.tsx` | Buttons node |
| `src/components/chatbot/nodes/BranchNode.tsx` | Branch node |
| `src/components/chatbot/nodes/ActionNode.tsx` | Action node |
| `src/components/chatbot/nodes/HandoffNode.tsx` | Handoff node |
| `src/components/chatbot/nodes/AiResponseNode.tsx` | AI response node |
| `src/components/chatbot/nodes/ArticleSuggestNode.tsx` | Article suggest node |
| `src/components/chatbot/nodes/CollectInputNode.tsx` | Input collection node |
| `src/components/chatbot/nodes/WebhookNode.tsx` | Webhook node |
| `src/components/chatbot/nodes/DelayNode.tsx` | Delay node |
| `src/app/api/chatbots/[id]/publish/route.ts` | Publish API |
| `src/app/api/chatbots/[id]/rollback/route.ts` | Rollback API |
| `src/app/api/chatbots/[id]/versions/route.ts` | Version list API |
| `src/app/api/chatbots/[id]/versions/[version]/route.ts` | Version detail API |
| `src/app/api/chatbots/[id]/execute/route.ts` | Flow execution API |
| `src/app/api/chatbots/[id]/execute/[sessionId]/route.ts` | Session execution API |
| `src/app/api/chatbots/[id]/analytics/route.ts` | Analytics API |
| `src/app/api/chatbots/[id]/analytics/summary/route.ts` | Analytics summary API |
| `src/app/api/chatbots/[id]/test/route.ts` | Test session API |
| `src/app/api/chatbots/ai-respond/route.ts` | AI response API |
| `src/lib/chatbot/analytics.ts` | Analytics aggregation logic |
| `src/lib/chatbot/versions.ts` | Version management logic |
| `src/lib/chatbot/templates.ts` | Pre-built flow templates |
| `cli/commands/chatbot.ts` | CLI chatbot commands |
| `src/lib/chatbot/__tests__/analytics.test.ts` | Analytics tests |
| `src/lib/chatbot/__tests__/versions.test.ts` | Version management tests |
| `src/lib/chatbot/__tests__/new-nodes.test.ts` | New node type runtime tests |

### Files to Modify

| File | Changes |
|------|---------|
| `src/db/schema.ts` | Add chatbot columns + 3 new tables |
| `src/lib/chatbot/types.ts` | Add position, new node types, new data interfaces |
| `src/lib/chatbot/runtime.ts` | Add handlers for 5 new node types |
| `src/lib/chatbot/store.ts` | Handle new fields, version management |
| `src/app/chatbots/page.tsx` | Update list view, remove inline builder |
| `src/app/chat/embed/page.tsx` | Render new node type responses |
| `src/app/chat/page.tsx` | Show bot context on agent console |
| `src/app/api/chat/route.ts` | Handle new runtime response types |
| `src/app/api/chatbots/route.ts` | Accept new fields |
| `src/app/api/chatbots/[id]/route.ts` | Accept new fields |
| `cli/mcp/tools/chatbots.ts` | Add 10 new MCP tools |
| `cli/commands/index.ts` | Register chatbot command group |
| `src/lib/features/gates.ts` | Add chatbot_builder feature (optional) |
| `src/lib/chat.ts` | Persist sessions to DB |
| `package.json` | Add `@xyflow/react` dependency |
| `ARCHITECTURE.md` | Document chatbot builder |
