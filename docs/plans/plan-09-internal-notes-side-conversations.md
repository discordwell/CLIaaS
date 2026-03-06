# Plan 09: Internal Notes & Side Conversations

## 1. Summary of What Exists Today

### DB Schema (`src/db/schema.ts`)

**Messages table already has visibility support (`:339-359`):**
- `messageVisibilityEnum` with values `'public'` and `'internal'` (`:80-83`)
- `messages.visibility` column using that enum, defaults to `'public'` (`:349`)
- `messages.authorType` enum: `'user'`, `'customer'`, `'system'`, `'bot'` (`:73-78`)
- `messages.authorId` column (nullable UUID) (`:346`)

**Conversations table (`:323-337`):**
- One conversation per ticket (enforced by `uniqueIndex('conversations_ticket_idx')` on `ticketId` at `:334`)
- This unique constraint **blocks side conversations** -- currently only one conversation thread per ticket
- `channelType` column exists (`email`, `chat`, `api`, etc.) (`:329`)

**No @mention infrastructure:**
- `users` table has `id`, `email`, `name`, `role` (`:157-178`)
- No `notifications` or `notification_preferences` table exists anywhere in the schema
- No mention parsing or notification dispatch anywhere in the codebase

**No side conversation concept:**
- No `side_conversations` table or equivalent
- `conversations_ticket_idx` unique index prevents multiple conversations per ticket
- Search for "side.?conversation" returns only competitive analysis docs, not code

### Canonical Types

**CLI schema types (`cli/schema/types.ts:6,26-35`):**
- `MessageType = 'reply' | 'note' | 'system'` -- `note` type exists
- `Message` interface has `type: MessageType` but no `visibility` field

**DataProvider types (`src/lib/data-provider/types.ts:37-44,162-168`):**
- `Message` interface has `type: 'reply' | 'note' | 'system'` (`:42`) but no `visibility` field
- `MessageCreateParams` already has optional `visibility?: 'public' | 'internal'` (`:167`)
- DataProvider `createMessage()` accepts `MessageCreateParams` (`:211`)

### API Routes

**`POST /api/tickets/[id]/reply` (`src/app/api/tickets/[id]/reply/route.ts`):**
- Accepts `{ message, isNote }` body (`:22`)
- Passes `isNote` flag to connector-specific reply functions (Zendesk, Freshdesk, Groove) (`:46-85`)
- Fires `messageCreated` event with `isNote` flag (`:87`)
- Does NOT persist the message locally (relies on connector round-trip)

**`GET /api/tickets/[id]/messages` (`src/app/api/tickets/[id]/messages/route.ts`):**
- Returns all messages for a ticket via `loadMessages(id)` (`:20`)
- Does NOT filter by visibility -- returns everything including internal notes

**Portal ticket API (`src/app/api/portal/tickets/[id]/route.ts`):**
- DB path: already filters `WHERE visibility = 'public'` (`:87`) -- internal notes correctly hidden
- JSONL fallback: filters `m.type !== 'note'` (`:163`) -- internal notes correctly hidden
- Portal POST always creates messages with `visibility: 'public'` (`:284`)

### UI Components

**Agent ticket detail (`src/app/tickets/[id]/page.tsx`):**
- Shows "Internal Note" badge when `msg.type === 'note'` (`:152-155`)
- Does NOT visually differentiate note background color from replies
- Shows all messages regardless of type (no filtering)

**TicketActions component (`src/components/TicketActions.tsx`):**
- Already has Reply/Note toggle via `isNote` checkbox (`:136-143`)
- Button text changes: "Send Reply" vs "Add Note" (`:157`)
- Sends `{ message, isNote }` to the reply API (`:37`)

**Portal ticket detail (`src/app/portal/tickets/[id]/page.tsx`):**
- Receives pre-filtered messages from the API (only public)
- No note toggle -- customers can only send public replies
- Unified timeline with messages + events

### MCP Tools

**`ticket_note` tool exists (`cli/mcp/tools/actions.ts:137-183`):**
- Accepts `ticketId`, `body`, `confirm` parameters
- Records action via `recordMCPAction()` (`:160-164`)
- Auto-enqueues upstream push if ticket has external source (`:166-174`)
- Does NOT actually persist the note to local storage or DB -- only records it as an MCP action

**`ticket_reply` tool (`cli/mcp/tools/actions.ts:89-135`):**
- Similar pattern to `ticket_note` but for public replies
- Also does not persist locally

**`tickets_show` tool (`cli/mcp/tools/tickets.ts:54-97`):**
- Shows all messages in thread (`:88-94`)
- Does NOT expose message `type` or `visibility` -- only `id`, `author`, `type`, `body`, `createdAt`
- Wait -- actually DOES expose `type` at `:92`, which differentiates notes

### Event Pipeline (`src/lib/events/dispatcher.ts`)

- `message.created` is a canonical event (`:22`)
- Fans out to webhooks, plugins, SSE, automation, AI resolution (`:98-163`)
- No concept of "mention" events -- no `mention.created` or `note.created` events
- `messageCreated()` helper in `src/lib/events/index.ts:21-23` accepts generic `Record<string, unknown>` data

### Email Sender (`src/lib/email/sender.ts`)

- `sendTicketReply()` -- sends email to customer (`:70-93`)
- `sendNotification()` -- internal notification templates: escalation, sla_breach, assignment, new_ticket (`:95-113`)
- No "mention" notification template
- No guard against sending internal notes via email to customers

### Data Providers

- `DbProvider.createMessage()` inserts into DB with visibility field
- `JsonlProvider.createMessage()` stores in JSONL
- `RemoteProvider.createMessage()` maps `visibility: 'internal'` to `isNote: true` and POSTs to `/api/tickets/:id/reply`
- `HybridProvider.createMessage()` writes to local DB + sync outbox

### What's Missing (Gap Summary)

1. **Side conversations**: No table, no API, no UI. The `conversations` table has a unique constraint on `ticketId` preventing multiple threads.
2. **@mentions in notes**: No mention parsing, no notification table, no notification delivery.
3. **Agent UI note differentiation**: Notes shown with a small badge but no distinct visual treatment (e.g., yellow background).
4. **Message API visibility filtering**: `GET /api/tickets/[id]/messages` returns internal notes to all callers without role-based filtering.
5. **Email safety**: No explicit guard preventing `sendTicketReply()` from being called for internal notes.
6. **MCP `ticket_note` persistence**: Tool records the action but doesn't actually write to storage.
7. **Side conversation MCP tools**: None exist.
8. **Notification preferences**: No table or UI for agents to manage notification settings.

---

## 2. Proposed DB Schema Changes

### 2a. Modify `conversations` table

**Drop the unique constraint** on `ticketId` to allow multiple conversations per ticket:

```
- conversationsTicketIdx: uniqueIndex('conversations_ticket_idx').on(table.ticketId)
+ conversationsTicketIdx: index('conversations_ticket_idx').on(table.ticketId)
```

**Add columns to `conversations`:**

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `kind` | enum `'primary' \| 'side'` | `'primary'` | Distinguishes main thread from side conversations |
| `subject` | `text` | `null` | Side conversation subject line (nullable for primary) |
| `external_email` | `varchar(320)` | `null` | Email address of external party for side conversations |
| `created_by_id` | `uuid` | `null` | FK to `users.id` -- agent who created the side conversation |
| `status` | enum `'open' \| 'closed'` | `'open'` | Side conversation lifecycle |

**New enum:**

```sql
CREATE TYPE conversation_kind AS ENUM ('primary', 'side');
CREATE TYPE side_conversation_status AS ENUM ('open', 'closed');
```

**New index:**

```sql
CREATE UNIQUE INDEX conversations_primary_ticket_idx
  ON conversations (ticket_id) WHERE kind = 'primary';
```

This preserves the invariant that each ticket has exactly one primary conversation while allowing multiple side conversations.

### 2b. New `mentions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `message_id` | `uuid` FK→messages | The note containing the mention |
| `mentioned_user_id` | `uuid` FK→users | The agent being mentioned |
| `workspace_id` | `uuid` FK→workspaces | For RLS |
| `read_at` | `timestamptz` | Null until read |
| `created_at` | `timestamptz` | |

**Indexes:**
- `mentions_user_unread_idx` on `(mentioned_user_id, read_at)` WHERE `read_at IS NULL`
- `mentions_message_idx` on `(message_id)`

### 2c. New `notifications` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` FK→workspaces | For RLS |
| `user_id` | `uuid` FK→users | Recipient |
| `type` | enum `'mention' \| 'side_conversation_reply' \| 'assignment' \| 'escalation'` | |
| `title` | `text` | Short title |
| `body` | `text` | Preview text |
| `resource_type` | `text` | `'ticket'`, `'side_conversation'`, etc. |
| `resource_id` | `uuid` | FK to the relevant entity |
| `read_at` | `timestamptz` | Null until read |
| `created_at` | `timestamptz` | |

**Indexes:**
- `notifications_user_unread_idx` on `(user_id, read_at)` WHERE `read_at IS NULL`
- `notifications_user_created_idx` on `(user_id, created_at DESC)`

### 2d. Add `mentions` column to `messages` table

| Column | Type | Notes |
|--------|------|-------|
| `mentioned_user_ids` | `uuid[]` | Array of user IDs mentioned in the message body. Denormalized for fast display. |

### 2e. New `notification_type` enum

```sql
CREATE TYPE notification_type AS ENUM (
  'mention',
  'side_conversation_reply',
  'assignment',
  'escalation'
);
```

### Migration file: `0005_internal_notes_side_conversations.sql`

Summary of changes:
- New enums: `conversation_kind`, `side_conversation_status`, `notification_type`
- ALTER `conversations`: add `kind`, `subject`, `external_email`, `created_by_id`, `status` columns; replace unique index with conditional unique
- ALTER `messages`: add `mentioned_user_ids` column
- New tables: `mentions`, `notifications`

---

## 3. New API Routes

### 3a. Side Conversations

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/tickets/[id]/side-conversations` | List side conversations for a ticket |
| `POST` | `/api/tickets/[id]/side-conversations` | Create a new side conversation |
| `GET` | `/api/tickets/[id]/side-conversations/[scId]` | Get a single side conversation with messages |
| `POST` | `/api/tickets/[id]/side-conversations/[scId]/reply` | Reply to a side conversation |
| `PATCH` | `/api/tickets/[id]/side-conversations/[scId]` | Close/reopen a side conversation |

**`POST /api/tickets/[id]/side-conversations` body:**
```json
{
  "subject": "Question for vendor about part #123",
  "externalEmail": "vendor@example.com",
  "body": "Hi, can you check stock on part #123?",
  "sendEmail": true
}
```

**`POST /api/tickets/[id]/side-conversations/[scId]/reply` body:**
```json
{
  "body": "Following up on part #123",
  "sendEmail": true
}
```

### 3b. Internal Notes (enhance existing)

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/tickets/[id]/notes` | Dedicated note creation endpoint (separate from reply) |

**Body:**
```json
{
  "body": "Hey @jane.doe, can you take a look at this?",
  "mentions": ["user-uuid-1"]
}
```

This is separate from the existing `/api/tickets/[id]/reply` route to enforce visibility=internal at the route level rather than relying on a client-side `isNote` flag.

### 3c. Notifications

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/notifications` | List notifications for current user (paginated, filterable) |
| `PATCH` | `/api/notifications/[id]` | Mark notification as read |
| `POST` | `/api/notifications/read-all` | Mark all notifications as read |

### 3d. Mention Autocomplete

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/users/search?q=jane` | Search workspace users for @mention autocomplete |

### 3e. Inbound Email for Side Conversations

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/channels/email/side-conversation-inbound` | Webhook for replies to side conversation emails (thread back into ticket) |

### 3f. Modify Existing Routes

**`GET /api/tickets/[id]/messages`**: Add `?visibility=public|internal|all` query param. Default to `all` for authenticated agents. Portal API already filters correctly.

**`POST /api/tickets/[id]/reply`**: Continue supporting `isNote` flag for backward compatibility, but map it to `visibility: 'internal'` in the message creation. Add mention extraction from body text.

---

## 4. New/Modified UI Pages & Components

### 4a. Modified: `src/components/TicketActions.tsx`

**Current state**: Checkbox toggle for Reply/Note mode (`:136-143`).

**Changes:**
- Replace checkbox with a segmented toggle button group: **Reply** | **Note** (tab-like pills)
- When "Note" is active:
  - Textarea background becomes amber/yellow tint (`bg-amber-50`)
  - Label shows "Internal note -- not visible to customer"
  - Enable @mention autocomplete in the textarea (trigger on `@` character)
- Add @mention dropdown component that queries `/api/users/search`
- Mentioned users shown as highlighted tokens in the text

### 4b. Modified: `src/app/tickets/[id]/page.tsx`

**Changes:**
- Internal notes rendered with distinct visual: amber/yellow left border + light amber background + "Internal Note" badge (currently just has the badge)
- Mentioned users highlighted in note body (e.g., `@jane.doe` in bold blue)
- Add "Side Conversations" section below the main thread:
  - Collapsible panel listing all side conversations for the ticket
  - Each side conversation shows: subject, external email, status (open/closed), message count, last activity
  - Click to expand shows the side conversation thread inline
  - "New Side Conversation" button opens a creation form

### 4c. New: `src/components/SideConversationPanel.tsx`

**Client component** for the side conversations section:
- List of side conversations with expand/collapse
- Creation form: subject, external email, initial message, "Send email" checkbox
- Reply form within each expanded side conversation
- Close/reopen button per side conversation

### 4d. New: `src/components/MentionInput.tsx`

**Client component** for @mention-enabled textarea:
- On `@` keystroke, show dropdown of matching workspace users
- Arrow key navigation + Enter to select
- Selected mention rendered as highlighted inline token
- Outputs both the display text and an array of mentioned user IDs

### 4e. New: `src/components/NotificationBell.tsx`

**Client component** for the top navigation:
- Bell icon with unread count badge
- Dropdown showing recent notifications
- Click to navigate to the relevant ticket/side conversation
- "Mark all read" action

### 4f. Modified: `src/app/portal/tickets/[id]/page.tsx`

**No changes needed** -- portal already filters out internal notes correctly at the API level. Side conversations with external parties are agent-only; they do not appear in the customer portal. Verify this is enforced.

### 4g. Modified: Agent navigation (`src/components/AppNav.tsx` or equivalent)

- Add `NotificationBell` component to the nav bar

---

## 5. New CLI Commands

### 5a. `cliaas ticket note`

```
cliaas ticket note --ticket <id> --body "Internal note text" [--mention user@example.com]
```

- Creates an internal note on a ticket
- Parses @mentions from body text and `--mention` flag
- Triggers notification dispatch for mentioned users

### 5b. `cliaas ticket side-conversation`

```
cliaas ticket side-conversation list --ticket <id>
cliaas ticket side-conversation create --ticket <id> --subject "Question" --email vendor@example.com --body "Message"
cliaas ticket side-conversation reply --ticket <id> --sc <sc-id> --body "Follow up"
cliaas ticket side-conversation close --ticket <id> --sc <sc-id>
```

### 5c. `cliaas notifications`

```
cliaas notifications list [--unread]
cliaas notifications read <id>
cliaas notifications read-all
```

---

## 6. New MCP Tools

### 6a. `side_conversation_create` (new)

```
Tool: side_conversation_create
Params:
  ticketId: string       -- Parent ticket ID
  subject: string        -- Side conversation subject
  externalEmail: string  -- External party email
  body: string           -- Initial message
  sendEmail: boolean     -- Whether to send email (default: true)
  confirm: boolean       -- Confirmation gate
```

### 6b. `side_conversation_reply` (new)

```
Tool: side_conversation_reply
Params:
  ticketId: string               -- Parent ticket ID
  sideConversationId: string     -- Side conversation ID
  body: string                   -- Reply body
  sendEmail: boolean             -- Whether to send email
  confirm: boolean               -- Confirmation gate
```

### 6c. `side_conversation_list` (new)

```
Tool: side_conversation_list
Params:
  ticketId: string       -- Parent ticket ID
  status: string?        -- Filter: open, closed, all (default: all)
```

### 6d. Modify `ticket_note` (existing, `cli/mcp/tools/actions.ts:137-183`)

**Add parameters:**
- `mentions: string[]` -- Array of user emails or IDs to mention
- Actually persist the note via `DataProvider.createMessage()` with `visibility: 'internal'`

**Add behavior:**
- Parse @mentions from body text in addition to explicit `mentions` param
- Trigger notification dispatch for mentioned users
- Return the created message ID

### 6e. Modify `tickets_show` (existing, `cli/mcp/tools/tickets.ts:54-97`)

**Add to output:**
- `visibility` field on each message (`'public'` or `'internal'`)
- `sideConversations` array with count and summary per side conversation
- Filter option: `includeInternal: boolean` (default: true for agents)

---

## 7. Migration & Rollout Plan

### Phase 1: Schema & Internal Notes (S effort)

1. **Migration `0005_internal_notes_side_conversations.sql`**:
   - Add `mentioned_user_ids` column to `messages`
   - Create `mentions` table
   - Create `notifications` table
   - Add new enums

2. **Dedicated note API route**: `POST /api/tickets/[id]/notes`

3. **Persist notes in MCP `ticket_note`**: Wire through `DataProvider.createMessage()` with `visibility: 'internal'`

4. **Agent UI note styling**: Yellow background, left border for internal notes in ticket detail

5. **JSONL provider**: Add `visibility` field to the `Message` type in `src/lib/data-provider/types.ts` and `cli/schema/types.ts`

6. **Email safety guard**: In `sendTicketReply()` and the event dispatcher, explicitly skip customer email for messages with `visibility: 'internal'`

7. **Tests**: Unit tests for note creation, portal filtering (verify notes never leak), email suppression

### Phase 2: @Mentions & Notifications (M effort)

1. **Mention parsing utility** (`src/lib/mentions.ts`): Extract `@user.name` patterns from text, resolve to user IDs via DB lookup

2. **`MentionInput` component**: @-trigger autocomplete, user search API

3. **`NotificationBell` component**: Unread count, dropdown, mark-read

4. **Notification dispatch**: On note creation with mentions, insert into `mentions` table and `notifications` table, optionally send email notification to mentioned agents

5. **New canonical event**: `note.created` (extends `CanonicalEvent` in dispatcher) -- triggers mention notifications but NOT customer email

6. **User search API**: `GET /api/users/search?q=`

7. **CLI `cliaas notifications`**: List/read commands

8. **Tests**: Mention parsing, notification creation, notification read, bell component

### Phase 3: Side Conversations (L effort)

1. **Schema migration**: Alter `conversations` table (drop unique constraint, add columns), add conditional unique index

2. **Business logic**: `src/lib/side-conversations.ts` -- create, reply, list, close, email threading

3. **Side conversation API routes**: All 5 new routes

4. **`SideConversationPanel` component**: List, create, reply, close

5. **Inbound email webhook**: Parse `In-Reply-To` / `References` headers to match incoming email to the correct side conversation

6. **MCP tools**: `side_conversation_create`, `side_conversation_reply`, `side_conversation_list`

7. **CLI commands**: `cliaas ticket side-conversation` subcommands

8. **Email sending**: When `sendEmail: true`, use `sendEmail()` with proper threading headers so external party sees a threaded conversation

9. **Modify `tickets_show`**: Include side conversation summary in output

10. **Tests**: Side conversation CRUD, email threading, inbound routing, portal isolation (verify side conversations never appear in customer portal)

### Phase 4: Polish & Integration (S effort)

1. **Automation integration**: Allow triggers to fire on `note.created` and `side_conversation.reply_received`

2. **Audit logging**: All note/side-conversation actions logged to `audit_entries`

3. **Upstream sync**: When creating notes on tickets from external platforms, upstream adapters already support `create_note` operation -- verify all 8 adapters handle it correctly

4. **Connector import**: During sync from Zendesk/Freshdesk, map their internal notes to `visibility: 'internal'` messages and their side conversations to CLIaaS side conversations

5. **Documentation**: Update ARCHITECTURE.md with new tables and event types

### Rollout Order

```
Phase 1 (Week 1)     → Internal notes fully functional, safe from leaks
Phase 2 (Week 2)     → @mentions and notifications
Phase 3 (Weeks 3-4)  → Side conversations with email threading
Phase 4 (Week 4)     → Polish, automation hooks, connector parity
```

### Backward Compatibility

- Existing `isNote` flag on `POST /api/tickets/[id]/reply` continues to work (maps to `visibility: 'internal'`)
- Existing `ticket_note` MCP tool signature unchanged (new params are optional)
- JSONL mode: `Message.type = 'note'` continues to be filtered in portal (`:163` in portal route)
- The `conversations` unique index change is the riskiest migration -- requires a data check that no ticket has multiple conversations already

### Rollback Plan

- Each phase has its own migration; can be rolled back independently
- Phase 1 is additive (new columns, new tables) -- safe to roll back by dropping
- Phase 3's unique index change is the only destructive schema change; rollback requires re-adding the unique constraint (safe if we verify data invariant first)

---

## 8. Effort Estimate

| Phase | Description | Estimate | Files Touched |
|-------|-------------|----------|---------------|
| Phase 1 | Internal notes (schema, API, UI styling, email guard) | **S** | ~8 files |
| Phase 2 | @Mentions & notifications (parsing, UI components, bell, events) | **M** | ~12 files |
| Phase 3 | Side conversations (schema change, full CRUD, email threading, MCP, CLI) | **L** | ~20 files |
| Phase 4 | Polish & integration (automation, audit, upstream, connectors) | **S** | ~10 files |
| **Total** | | **L** | ~40 files |

**Overall: L (Large)**

Phases 1-2 could ship independently as a useful increment (internal notes + mentions). Phase 3 is the bulk of the work due to the schema change, email threading, and inbound routing complexity. Phase 4 is integration work that can be done incrementally.

**Key risk**: The `conversations` unique index change in Phase 3. Recommend running a data audit query before migration to verify the invariant holds, and testing extensively in a staging environment.
