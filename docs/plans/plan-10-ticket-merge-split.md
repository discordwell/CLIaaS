# Plan 10: Ticket Merge & Split

## 1. Summary of What Exists Today

### Ticket Schema (`src/db/schema.ts`)
- **`tickets` table** (`:286-321`): UUID PK, `workspaceId`, `tenantId`, `requesterId`, `assigneeId`, `subject`, `description`, `customerEmail`, `status` (enum: open/pending/on_hold/solved/closed), `priority` (enum: low/normal/high/urgent), `source` (provider enum), `tags` (text array), `customFields` (JSONB), timestamps. No merge/split metadata columns.
- **`conversations` table** (`:323-337`): 1:1 with ticket (unique index on `ticketId`), `channelType`, timestamps. This 1:1 constraint is important: merge needs to consolidate conversations; split needs to create a new one.
- **`messages` table** (`:339-359`): FK to `conversations.id`, `authorType`, `authorId`, `body`, `bodyHtml`, `visibility`, `createdAt`. Messages belong to conversations, not directly to tickets.
- **`attachments` table** (`:361-376`): FK to `messages.id`, `filename`, `size`, `contentType`, `storageKey`.
- **`tags` / `ticket_tags`** (`:378-405`): Many-to-many join via composite PK (`ticketId`, `tagId`).
- **`audit_events`** (`:684-702`): Generic audit with `action`, `objectType`, `objectId`, `diff` (JSONB). Can be used for merge/split audit.
- **`audit_entries`** (`:744-776`): More detailed audit with `userId`, `userName`, `resource`, `resourceId`, `details` (JSONB).

### DataProvider Interface (`src/lib/data-provider/types.ts`)
- **`Ticket` type** (`:19-35`): Flat interface with `id`, `externalId`, `source`, `subject`, `status`, `priority`, `assignee`, `requester`, `tags`, timestamps, `customFields`. No merge/split fields.
- **`Message` type** (`:37-44`): `id`, `ticketId`, `author`, `body`, `type` (reply/note/system), `createdAt`. Messages are keyed by `ticketId` (not `conversationId`), which simplifies the JSONL provider.
- **`DataProvider` interface** (`:190-213`): Has `createTicket`, `updateTicket`, `createMessage` methods. No merge/split methods.

### Data Providers
- **`JsonlProvider`** (`src/lib/data-provider/jsonl-provider.ts`): Read-only from JSONL files. Write operations throw. Merge/split in JSONL mode will need an in-memory store approach (like customer-store.ts).
- **`DbProvider`** (`src/lib/data-provider/db-provider.ts`): Full Drizzle read/write. Messages loaded via `conversations` JOIN `tickets` (`:173-246`). Merge/split will operate at the DB level here.
- **`HybridProvider`** (`src/lib/data-provider/hybrid-provider.ts`): Delegates to `DbProvider` locally, queues writes to `sync_outbox`.

### Ticket UI
- **Ticket list page** (`src/app/tickets/page.tsx`): Server component, renders table of tickets. No multi-select checkboxes, no merge button. No client-side state management.
- **Ticket detail page** (`src/app/tickets/[id]/page.tsx`): Shows ticket header + conversation thread + `TicketActions` component. Messages rendered with index numbers (`:149-151`). No split button, no message selection UI.
- **`TicketActions` component** (`src/components/TicketActions.tsx`): Client component with reply form + status/priority update. Posts to `/api/tickets/[id]/reply` and `PATCH /api/tickets/[id]`.

### Ticket API Routes (`src/app/api/tickets/`)
- `GET /api/tickets` — list with filters (`:route.ts`)
- `GET /api/tickets/[id]` — single ticket + messages
- `PATCH /api/tickets/[id]` — update status/priority (forwards to connector)
- `POST /api/tickets/[id]/reply` — add reply/note
- `POST /api/tickets/create` — create ticket
- `GET /api/tickets/[id]/messages` — messages for ticket
- `GET /api/tickets/stats` — aggregate stats
- **No merge or split endpoints.**

### CLI Ticket Commands (`cli/commands/tickets.ts`)
- `cliaas tickets list` — list with filters (`:7-88`)
- `cliaas tickets search` — full-text search (`:90-176`)
- `cliaas tickets show` — ticket detail + thread (`:178-244`)
- **No merge or split subcommands.**

### MCP Ticket Tools (`cli/mcp/tools/tickets.ts`, `cli/mcp/tools/actions.ts`)
- `tickets_list`, `tickets_show`, `tickets_search` — read tools
- `ticket_update`, `ticket_reply`, `ticket_note`, `ticket_create` — write tools with confirmation pattern
- `detect_duplicates` (`cli/mcp/tools/analysis.ts:214-268`) — finds similar tickets by subject, suggests tagging. **Does not merge.**
- **No `ticket_merge` or `ticket_split` tools.**

### Duplicate Detection (`cli/commands/duplicates.ts`)
- `cliaas duplicates` — bigram Jaccard similarity on subjects (`:93-116`)
- Output suggests `cliaas batch tag --add duplicate` — no merge action
- Natural workflow: detect duplicates -> merge them. Currently the second step is missing.

### Customer Merge Pattern (Reference) (`src/lib/customers/customer-store.ts`)
- `mergeCustomers()` (`:276-317`): Takes `primaryId`, `mergedId`, stores merge log entry, re-assigns activities/notes to primary, records activity. **This is the pattern to follow for ticket merge.**
- `CustomerMergeEntry` type (`:39-47`): `primaryCustomerId`, `mergedCustomerId`, `mergedData`, `mergedBy`, `createdAt`.
- Merge log persisted to JSONL (`:67`, `:84`).

### Event System (`src/lib/events/index.ts`)
- Canonical events include `ticket.created`, `ticket.updated`, `ticket.resolved`. No `ticket.merged` or `ticket.split` events.
- `dispatch()` fans out to webhooks, plugins, SSE, automation, AI resolution.

### What's Missing (Gap Summary)
1. No DB tables for merge/split history
2. No columns on `tickets` table for merge/split references
3. No API endpoints for merge or split
4. No UI for multi-select + merge or message-select + split
5. No CLI commands for merge/split
6. No MCP tools for merge/split
7. No events for `ticket.merged` / `ticket.split`
8. No undo/unmerge capability
9. `duplicates` CLI + `detect_duplicates` MCP tool find dupes but cannot act on them

---

## 2. Proposed DB Schema Changes

### New Table: `ticket_merge_log`

Records every merge operation for audit trail and potential unmerge.

```sql
CREATE TABLE ticket_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  -- The ticket that survived (received all messages)
  primary_ticket_id UUID NOT NULL REFERENCES tickets(id),
  -- The ticket that was closed/absorbed
  merged_ticket_id UUID NOT NULL REFERENCES tickets(id),
  -- Who performed the merge
  merged_by UUID REFERENCES users(id),
  -- Snapshot of the merged ticket at time of merge (for unmerge)
  merged_ticket_snapshot JSONB NOT NULL,
  -- Snapshot of moved message IDs (for unmerge)
  moved_message_ids UUID[] DEFAULT '{}',
  -- Snapshot of moved attachment IDs
  moved_attachment_ids UUID[] DEFAULT '{}',
  -- Tags that were added to primary from merged ticket
  merged_tags TEXT[] DEFAULT '{}',
  -- Whether this merge has been undone
  undone BOOLEAN NOT NULL DEFAULT false,
  undone_at TIMESTAMPTZ,
  undone_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ticket_merge_log_workspace_idx ON ticket_merge_log(workspace_id, created_at);
CREATE INDEX ticket_merge_log_primary_idx ON ticket_merge_log(primary_ticket_id);
CREATE INDEX ticket_merge_log_merged_idx ON ticket_merge_log(merged_ticket_id);
```

### New Table: `ticket_split_log`

Records every split operation.

```sql
CREATE TABLE ticket_split_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  -- The original ticket that was split from
  source_ticket_id UUID NOT NULL REFERENCES tickets(id),
  -- The new ticket created from the split
  new_ticket_id UUID NOT NULL REFERENCES tickets(id),
  -- Who performed the split
  split_by UUID REFERENCES users(id),
  -- IDs of messages moved to the new ticket
  moved_message_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ticket_split_log_workspace_idx ON ticket_split_log(workspace_id, created_at);
CREATE INDEX ticket_split_log_source_idx ON ticket_split_log(source_ticket_id);
CREATE INDEX ticket_split_log_new_idx ON ticket_split_log(new_ticket_id);
```

### New Columns on `tickets` Table

```sql
-- Soft-merge status: merged tickets are closed but retain a pointer
ALTER TABLE tickets ADD COLUMN merged_into_ticket_id UUID REFERENCES tickets(id);
-- Split lineage: if this ticket was created by splitting another
ALTER TABLE tickets ADD COLUMN split_from_ticket_id UUID REFERENCES tickets(id);

CREATE INDEX tickets_merged_into_idx ON tickets(merged_into_ticket_id) WHERE merged_into_ticket_id IS NOT NULL;
CREATE INDEX tickets_split_from_idx ON tickets(split_from_ticket_id) WHERE split_from_ticket_id IS NOT NULL;
```

### Drizzle Schema Additions (`src/db/schema.ts`)

Add to the `tickets` table definition:
```typescript
mergedIntoTicketId: uuid('merged_into_ticket_id').references(() => tickets.id),
splitFromTicketId: uuid('split_from_ticket_id').references(() => tickets.id),
```

New tables:
```typescript
export const ticketMergeLog = pgTable('ticket_merge_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  primaryTicketId: uuid('primary_ticket_id').notNull().references(() => tickets.id),
  mergedTicketId: uuid('merged_ticket_id').notNull().references(() => tickets.id),
  mergedBy: uuid('merged_by').references(() => users.id),
  mergedTicketSnapshot: jsonb('merged_ticket_snapshot').notNull(),
  movedMessageIds: uuid('moved_message_ids').array().default([]),
  movedAttachmentIds: uuid('moved_attachment_ids').array().default([]),
  mergedTags: text('merged_tags').array().default([]),
  undone: boolean('undone').notNull().default(false),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  undoneBy: uuid('undone_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  mergeLogWorkspaceIdx: index('ticket_merge_log_workspace_idx').on(table.workspaceId, table.createdAt),
  mergeLogPrimaryIdx: index('ticket_merge_log_primary_idx').on(table.primaryTicketId),
  mergeLogMergedIdx: index('ticket_merge_log_merged_idx').on(table.mergedTicketId),
}));

export const ticketSplitLog = pgTable('ticket_split_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  sourceTicketId: uuid('source_ticket_id').notNull().references(() => tickets.id),
  newTicketId: uuid('new_ticket_id').notNull().references(() => tickets.id),
  splitBy: uuid('split_by').references(() => users.id),
  movedMessageIds: uuid('moved_message_ids').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  splitLogWorkspaceIdx: index('ticket_split_log_workspace_idx').on(table.workspaceId, table.createdAt),
  splitLogSourceIdx: index('ticket_split_log_source_idx').on(table.sourceTicketId),
  splitLogNewIdx: index('ticket_split_log_new_idx').on(table.newTicketId),
}));
```

### JSONL Mode Additions

New JSONL files in the data directory:
- `ticket-merge-log.jsonl` — mirrors `ticket_merge_log` table
- `ticket-split-log.jsonl` — mirrors `ticket_split_log` table

### DataProvider Type Extensions (`src/lib/data-provider/types.ts`)

```typescript
export interface TicketMergeParams {
  primaryTicketId: string;
  mergedTicketIds: string[];   // supports 2+ tickets
  mergedBy?: string;
}

export interface TicketMergeResult {
  mergeLogIds: string[];
  primaryTicketId: string;
  mergedCount: number;
  movedMessageCount: number;
  mergedTags: string[];
}

export interface TicketSplitParams {
  sourceTicketId: string;
  messageIds: string[];        // messages to move to new ticket
  newSubject?: string;         // subject for the new ticket (defaults to "Split from #X: <original subject>")
  splitBy?: string;
}

export interface TicketSplitResult {
  splitLogId: string;
  newTicketId: string;
  movedMessageCount: number;
}

export interface TicketUnmergeParams {
  mergeLogId: string;
  unmergedBy?: string;
}

// Add to DataProvider interface:
mergeTickets(params: TicketMergeParams): Promise<TicketMergeResult>;
splitTicket(params: TicketSplitParams): Promise<TicketSplitResult>;
unmergeTicket(params: TicketUnmergeParams): Promise<void>;
```

---

## 3. New API Routes Needed

### `POST /api/tickets/merge`

Merge 2+ tickets into a primary ticket.

**Request body:**
```json
{
  "primaryTicketId": "uuid",
  "mergedTicketIds": ["uuid", "uuid"],
  "mergedBy": "uuid (optional, from auth)"
}
```

**Logic:**
1. Validate all ticket IDs exist and belong to same workspace.
2. For each merged ticket:
   a. Snapshot the ticket state (for unmerge).
   b. Move all messages from merged ticket's conversation to primary ticket's conversation, preserving `createdAt` order.
   c. Move all attachments (they follow messages, so no separate action needed).
   d. Union tags: add merged ticket's tags to primary (deduplicate).
   e. Set `merged_ticket.status = 'closed'`, `merged_ticket.merged_into_ticket_id = primaryTicketId`.
   f. Add system message to primary: "Ticket #X was merged into this ticket by <user>".
   g. Add system message to merged: "This ticket was merged into #Y by <user>".
   h. Insert `ticket_merge_log` row.
3. Fire `ticket.merged` event.
4. Return merge result.

**Response:**
```json
{
  "mergeLogIds": ["uuid"],
  "primaryTicketId": "uuid",
  "mergedCount": 2,
  "movedMessageCount": 15,
  "mergedTags": ["billing", "urgent"]
}
```

**File:** `src/app/api/tickets/merge/route.ts`

### `POST /api/tickets/[id]/split`

Split selected messages from a ticket into a new ticket.

**Request body:**
```json
{
  "messageIds": ["uuid", "uuid"],
  "newSubject": "Optional new subject",
  "splitBy": "uuid (optional, from auth)"
}
```

**Logic:**
1. Validate source ticket and all message IDs belong to it.
2. Must leave at least 1 message in the source ticket.
3. Create new ticket:
   - Copy `requesterId`, `customerEmail`, `workspaceId`, `tenantId`, `source`, `priority` from source.
   - Set `subject` to provided value or `"Split from #<externalId>: <original subject>"`.
   - Set `status = 'open'`.
   - Set `split_from_ticket_id = sourceTicketId`.
4. Create new conversation for the new ticket.
5. Move selected messages to the new conversation (update `conversation_id` FK).
6. Add system message to source: "Messages were split to ticket #Y by <user>".
7. Add system message to new ticket: "This ticket was split from #X by <user>".
8. Insert `ticket_split_log` row.
9. Fire `ticket.split` event.
10. Return split result.

**Response:**
```json
{
  "splitLogId": "uuid",
  "newTicketId": "uuid",
  "movedMessageCount": 3
}
```

**File:** `src/app/api/tickets/[id]/split/route.ts`

### `POST /api/tickets/merge/undo`

Undo a merge operation within a configurable time window (default: 24 hours).

**Request body:**
```json
{
  "mergeLogId": "uuid",
  "unmergedBy": "uuid (optional)"
}
```

**Logic:**
1. Look up merge log entry. Validate it exists, is not already undone, and is within the undo window.
2. Restore merged ticket from snapshot (status, tags, subject, etc.).
3. Move messages back to the merged ticket's conversation (using `moved_message_ids`).
4. Clear `merged_into_ticket_id` on the merged ticket.
5. Remove union-added tags from primary (using `merged_tags`).
6. Add system messages to both tickets noting the unmerge.
7. Mark merge log entry as `undone = true`.
8. Fire `ticket.unmerged` event.

**File:** `src/app/api/tickets/merge/undo/route.ts`

### `GET /api/tickets/[id]/merge-history`

Return merge/split history for a ticket.

**File:** `src/app/api/tickets/[id]/merge-history/route.ts`

---

## 4. New/Modified UI Pages & Components

### Modified: Ticket List Page (`src/app/tickets/page.tsx`)

**Changes:**
- Add checkbox column to ticket table for multi-select.
- Add floating action bar at bottom of page when 2+ tickets selected, containing:
  - "Merge N tickets" button
  - Radio buttons or dropdown to pick primary ticket
- Wire merge button to `POST /api/tickets/merge`.
- Show "merged" badge on tickets that have `merged_into_ticket_id` set.

**New client component:** `src/components/TicketMergeBar.tsx`
- Receives selected ticket IDs as props.
- Renders primary ticket selector (default: oldest ticket).
- Confirm modal showing preview of what will be merged.
- Calls merge API on confirm.

### Modified: Ticket Detail Page (`src/app/tickets/[id]/page.tsx`)

**Changes:**
- Add merge/split lineage banner at top of ticket:
  - If `merged_into_ticket_id` is set: "This ticket was merged into #X" with link.
  - If `split_from_ticket_id` is set: "This ticket was split from #X" with link.
  - If ticket has merge log entries where it is the primary: "Tickets #A, #B were merged into this ticket" with links.
- Add message checkboxes for split selection.
- Add "Split selected" button (appears when messages are checked).
- Add "Merge history" expandable section showing merge/split log.

**New client component:** `src/components/TicketSplitBar.tsx`
- Receives source ticket ID and selected message IDs.
- Input field for new ticket subject (with sensible default).
- Confirm modal showing which messages will be moved.
- Calls split API on confirm.

**New client component:** `src/components/MergeHistoryPanel.tsx`
- Shows merge/split timeline for the ticket.
- Undo button for recent merges (within undo window).
- Links to related tickets.

### Modified: `TicketActions` Component (`src/components/TicketActions.tsx`)

**Changes:**
- No changes to existing functionality.
- The split and merge UIs are separate components rendered alongside `TicketActions` on the detail page.

---

## 5. New CLI Commands

### `cliaas tickets merge`

```
cliaas tickets merge --ids <id1,id2,...> --primary <id>
```

**Options:**
- `--ids <list>` (required): Comma-separated ticket IDs to merge
- `--primary <id>` (required): Which ticket should be the primary (must be in `--ids`)
- `--dir <dir>`: Export directory override
- `--dry-run`: Preview merge without executing
- `--json`: Output as JSON

**Logic:**
1. Load tickets from data provider.
2. Validate all IDs exist, primary is in the list.
3. If `--dry-run`, show preview: tickets to merge, message counts, tag unions.
4. Otherwise, call `mergeTickets()` on the data provider.
5. Display merge result.

**File:** Add `merge` subcommand to `cli/commands/tickets.ts` (`:6-88` is the existing registration function).

### `cliaas tickets split`

```
cliaas tickets split --ticket <id> --messages <id1,id2,...> [--subject "New subject"]
```

**Options:**
- `--ticket <id>` (required): Source ticket ID
- `--messages <list>` (required): Comma-separated message IDs to split out
- `--subject <text>`: Subject for the new ticket
- `--dir <dir>`: Export directory override
- `--dry-run`: Preview split without executing

**File:** Add `split` subcommand to `cli/commands/tickets.ts`.

### Enhanced: `cliaas duplicates`

Add `--merge` flag to existing duplicates command:

```
cliaas duplicates --merge --threshold 90
```

When `--merge` is set, after detecting duplicate groups, prompt user to confirm merge for each group (or auto-merge if `--yes` is also passed). Uses the oldest ticket in each group as primary.

**File:** Modify `cli/commands/duplicates.ts` (`:7-87`).

---

## 6. New MCP Tools

### `ticket_merge`

**Registration:** `cli/mcp/tools/actions.ts` (add alongside existing `ticket_update`, `ticket_reply`, etc.)

```typescript
server.tool(
  'ticket_merge',
  'Merge 2+ tickets into a primary ticket. Moves all messages, attachments, and tags. Closes secondary tickets. (requires confirm=true)',
  {
    primaryTicketId: z.string().describe('Primary ticket ID (will receive all messages)'),
    mergedTicketIds: z.array(z.string()).describe('Ticket IDs to merge into primary'),
    confirm: z.boolean().optional().describe('Must be true to execute merge'),
    dir: z.string().optional().describe('Export directory override'),
  },
  async ({ primaryTicketId, mergedTicketIds, confirm, dir }) => { ... }
);
```

**Scope:** `ticket_merge` (new scope in `cli/mcp/tools/scopes.ts`)

### `ticket_split`

```typescript
server.tool(
  'ticket_split',
  'Split selected messages from a ticket into a new ticket. (requires confirm=true)',
  {
    ticketId: z.string().describe('Source ticket ID'),
    messageIds: z.array(z.string()).describe('Message IDs to move to new ticket'),
    newSubject: z.string().optional().describe('Subject for new ticket'),
    confirm: z.boolean().optional().describe('Must be true to execute split'),
    dir: z.string().optional().describe('Export directory override'),
  },
  async ({ ticketId, messageIds, newSubject, confirm, dir }) => { ... }
);
```

**Scope:** `ticket_split` (new scope)

Both tools use the existing `withConfirmation()` pattern from `cli/mcp/tools/confirm.ts` and `recordMCPAction()` for audit.

### Enhanced: `detect_duplicates`

Add optional `autoMerge` parameter to the existing `detect_duplicates` tool (`cli/mcp/tools/analysis.ts:214`):

```typescript
autoMerge: z.boolean().optional().describe('If true with confirm=true, automatically merge detected duplicates'),
```

When `autoMerge` is true, the tool calls `ticket_merge` for each duplicate group, using the oldest ticket as primary.

---

## 7. Migration / Rollout Plan

### Phase 1: Schema & Business Logic (M)

1. **DB migration** (`src/db/migrations/0006_ticket_merge_split.sql`):
   - Add `merged_into_ticket_id` and `split_from_ticket_id` columns to `tickets`.
   - Create `ticket_merge_log` and `ticket_split_log` tables.
   - Add indexes.

2. **Drizzle schema** (`src/db/schema.ts`):
   - Add new columns to `tickets` table definition.
   - Add `ticketMergeLog` and `ticketSplitLog` table definitions.

3. **Business logic** — new file `src/lib/tickets/merge-split.ts`:
   - `mergeTickets(params)`: DB transaction that moves messages, unions tags, closes secondaries, writes merge log, fires events.
   - `splitTicket(params)`: DB transaction that creates new ticket + conversation, moves messages, writes split log, fires events.
   - `unmergeTicket(params)`: DB transaction that reverses a merge using the snapshot.
   - `getMergeHistory(ticketId)`: Returns merge/split log entries for a ticket.

4. **JSONL store** — new file `src/lib/tickets/merge-split-store.ts`:
   - In-memory merge/split log with JSONL persistence (following `customer-store.ts` pattern).
   - `mergeTicketsJsonl()`: Re-assigns messages in memory, updates ticket status, persists.
   - `splitTicketJsonl()`: Creates new ticket entry, moves messages, persists.

5. **DataProvider extension**:
   - Add `mergeTickets`, `splitTicket`, `unmergeTicket` to `DataProvider` interface.
   - Implement in `DbProvider`, `JsonlProvider` (throws or uses JSONL store), `HybridProvider`.

6. **Event system** (`src/lib/events/index.ts`):
   - Add `ticketMerged()` and `ticketSplit()` helper functions.
   - Register `ticket.merged` and `ticket.split` as canonical events.

7. **Tests**:
   - Unit tests for merge logic: message ordering, tag union, snapshot, unmerge.
   - Unit tests for split logic: message movement, new ticket creation, back-references.
   - Edge cases: merge ticket with itself (error), split all messages (error), merge already-merged ticket.

### Phase 2: API Routes (S)

1. `POST /api/tickets/merge` — `src/app/api/tickets/merge/route.ts`
2. `POST /api/tickets/[id]/split` — `src/app/api/tickets/[id]/split/route.ts`
3. `POST /api/tickets/merge/undo` — `src/app/api/tickets/merge/undo/route.ts`
4. `GET /api/tickets/[id]/merge-history` — `src/app/api/tickets/[id]/merge-history/route.ts`
5. API integration tests.

### Phase 3: CLI & MCP (S)

1. Add `merge` and `split` subcommands to `cli/commands/tickets.ts`.
2. Add `ticket_merge` and `ticket_split` MCP tools to `cli/mcp/tools/actions.ts`.
3. Add `ticket_merge` and `ticket_split` scopes to `cli/mcp/tools/scopes.ts`.
4. Enhance `cliaas duplicates` with `--merge` flag.
5. Enhance `detect_duplicates` MCP tool with `autoMerge` parameter.
6. CLI and MCP tests.

### Phase 4: UI (M)

1. `src/components/TicketMergeBar.tsx` — multi-select merge UI for ticket list.
2. `src/components/TicketSplitBar.tsx` — message-select split UI for ticket detail.
3. `src/components/MergeHistoryPanel.tsx` — merge/split history timeline.
4. Modify `src/app/tickets/page.tsx` — add checkboxes + merge bar.
5. Modify `src/app/tickets/[id]/page.tsx` — add lineage banners, split bar, history panel.
6. Component tests.

### Phase 5: Deploy & Verify (S)

1. Run migration on VPS Postgres.
2. Deploy via `scripts/deploy_vps.sh`.
3. Wet test: create demo tickets, merge them, verify messages consolidated, verify unmerge.
4. Wet test: split messages from a ticket, verify new ticket created with correct messages.
5. Hard wet test: merge already-merged tickets, split with 0 messages selected, unmerge after window.

### Rollout Considerations

- **Backward compatibility**: `merged_into_ticket_id` and `split_from_ticket_id` default to `NULL`. Existing queries are unaffected.
- **JSONL mode**: Merge/split in JSONL mode uses in-memory stores (like customer merge). Limited but functional for demos.
- **Undo window**: Configurable via environment variable `CLIAAS_MERGE_UNDO_HOURS` (default: 24). After this window, unmerge is disabled.
- **Conversations 1:1 constraint**: The existing `conversations_ticket_idx` unique index enforces one conversation per ticket. Merge must consolidate messages into the primary's conversation (not create multiple). This means updating `conversation_id` on moved messages.
- **External IDs**: Merged tickets retain their `externalId` for reference. No changes to external platform sync (merged tickets are just closed in CLIaaS).

---

## 8. Effort Estimate

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1: Schema & Business Logic | Migration, Drizzle schema, merge/split logic, JSONL store, DataProvider extension, events, tests | **M** (2-3 days) |
| Phase 2: API Routes | 4 new routes + integration tests | **S** (1 day) |
| Phase 3: CLI & MCP | 2 CLI subcommands, 2 MCP tools, enhanced duplicates | **S** (1 day) |
| Phase 4: UI | 3 new components, 2 modified pages | **M** (2-3 days) |
| Phase 5: Deploy & Verify | Migration, deploy, wet tests | **S** (0.5 day) |
| **Total** | | **L** (6-8 days) |

### Complexity Drivers
- **Merge message re-parenting**: Messages belong to conversations (not tickets directly). Moving messages means updating `conversation_id` FKs, which requires careful handling of the 1:1 ticket-conversation constraint.
- **Unmerge snapshot/restore**: Storing and restoring complete ticket state including tags, status, conversation, and message associations.
- **Multi-select UI**: The ticket list page is currently a server component with no client-side state. Adding multi-select requires converting to or wrapping with a client component.
- **Split message selection**: Adding per-message checkboxes to the conversation thread requires careful UX to not interfere with the existing reply flow.

### Risk Factors
- **1:1 conversation constraint**: If there are assumptions elsewhere (e.g., `uniqueIndex('conversations_ticket_idx')`) that exactly one conversation exists per ticket, merge must not violate this. Messages must be moved to the primary's conversation, not the conversation itself.
- **Attachments follow messages**: Since attachments FK to `messages.id`, they automatically follow when messages are re-parented. No separate attachment migration needed.
- **External platform sync**: Merging tickets in CLIaaS does not merge them in Zendesk/Freshdesk. The merged ticket is simply closed in CLIaaS. This is consistent with how other platforms handle imported tickets. Document this limitation.
