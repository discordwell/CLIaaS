# Plan 08: Real-Time Agent Collision Detection

## 1. Summary of What Exists Today

### SSE Event Bus (`src/lib/realtime/events.ts:1-69`)
- In-memory singleton `EventBus` class with typed event support
- Already defines presence event types: `presence:viewing`, `presence:typing`, `presence:left` (`:6-16`)
- Supports type-specific listeners via `on()` and global listeners via `onAny()` (`:31-59`)
- Singleton pattern survives HMR via `global.__cliaasEventBus` (`:63-68`)

### Presence Tracker (`src/lib/realtime/presence.ts:1-107`)
- In-memory singleton `PresenceTracker` class — **fully functional but not wired into the UI**
- Tracks `PresenceEntry` objects keyed by `userId:ticketId` with `activity: 'viewing' | 'typing'` and `lastSeen` timestamp (`:8-14`)
- `update()` method emits `presence:viewing` or `presence:typing` events on new entries or activity changes (`:31-51`)
- `leave()` method removes entry and emits `presence:left` (`:53-64`)
- `getViewers(ticketId)` returns all agents currently on a ticket (`:66-78`)
- Auto-cleanup every 30s removes entries older than 60s (`:80-92`) — emits `presence:left` for each expired entry
- **Gap**: Cleanup threshold is 60s, not 30s as specified in requirements. No workspace scoping.

### Presence API (`src/app/api/presence/route.ts:1-55`)
- `POST /api/presence` — updates presence (viewing/typing) or signals leave (`:12-41`)
- `GET /api/presence?ticketId=X` — returns current viewers for a ticket (`:43-54`)
- Both routes protected by `requireAuth()` (`:13, :44`)
- **Gap**: Accepts `userId`/`userName` from the request body instead of extracting from auth session — clients can impersonate.

### SSE Endpoint (`src/app/api/events/route.ts:1-63`)
- `GET /api/events` — Server-Sent Events stream, auth-protected (`:11`)
- Subscribes to ALL events via `eventBus.onAny()` and streams them to the client (`:23-28`)
- 30s keepalive interval (`:35-41`)
- Cleans up on abort signal (`:44-47`)
- **Gap**: No workspace filtering — all connected clients receive all events from all workspaces.

### CollisionDetector Component (`src/components/CollisionDetector.tsx:1-93`)
- Client component that polls `/api/presence` every 10s (`:61`)
- Posts `viewing` activity on mount, sends `leave` on unmount (`:23-38, :67-73`)
- Filters out current user from viewer list, renders amber warning bar (`:77-92`)
- Shows who is "viewing" vs "typing" (`:88`)
- **NOT USED ANYWHERE** — exists as a component but is not imported by any page.

### ActivityFeed Component (`src/components/ActivityFeed.tsx:1-117`)
- Client component that connects to `/api/events` via `EventSource` (`:17`)
- Listens for all event types including `presence:viewing`, `presence:typing`, `presence:left` (`:39-41`)
- Renders a feed with event type icons (`:56-66`)
- **NOT USED ANYWHERE** — exists but is not imported by any page.

### Ticket Detail Page (`src/app/tickets/[id]/page.tsx:1-207`)
- Server component — loads ticket and messages, renders header + metadata + conversation thread
- Uses `TicketActions` component for reply/update forms (`:173-177`)
- **No collision detection** — no `CollisionDetector` import, no presence tracking, no SSE subscription
- **No typing indicator** — textarea has no `onFocus`/`onChange` handler for typing state

### TicketActions Component (`src/components/TicketActions.tsx:1-165`)
- Client component with reply textarea and status/priority update form
- Calls `POST /api/tickets/{id}/reply` and `PATCH /api/tickets/{id}` (`:34, :59`)
- **No collision awareness** — does not check if another agent replied while composing
- **No typing broadcast** — does not signal typing state to presence tracker

### Reply API (`src/app/api/tickets/[id]/reply/route.ts:1-95`)
- Posts reply to external helpdesk via connector (Zendesk, Freshdesk, Groove, HelpCrunch)
- Fires `messageCreated()` event on success (`:87`)
- **No collision check** — does not warn or block if another reply was submitted concurrently

### Event Dispatcher (`src/lib/events/dispatcher.ts:1-164`)
- Unified fan-out: webhooks, plugins, SSE, automation, AI resolution
- Maps `message.created` to SSE event `ticket:reply` (`:69`)
- **No presence-specific dispatch** — presence events bypass the dispatcher, emitted directly by PresenceTracker

### Redis Infrastructure (`src/lib/queue/connection.ts:1-70`)
- Lazy-init ioredis singleton via `getRedis()` — returns `null` when `REDIS_URL` unset
- Used by BullMQ job queues (webhook, automation, AI resolution, email)
- `isRedisAvailable()` helper for feature detection
- **Not used for presence** — presence is purely in-memory today

### DB Schema (`src/db/schema.ts`)
- `messages` table (`:339-358`) with `createdAt` timestamp — can be used for "reply submitted while composing" detection
- `conversations` table (`:323-337`) with `lastActivityAt` — useful for staleness checks
- `users` table (`:156-172`) with `id`, `name`, `email` — identity source for presence
- **No presence/collision tables** — presence is entirely in-memory (by design for ephemeral data)

### MCP Tools
- `ticket_reply`, `ticket_note`, `ticket_update` in `cli/mcp/tools/actions.ts` — no presence or collision awareness
- No MCP tools for presence querying or collision detection

---

## 2. Proposed DB Schema Changes

**No new tables required.** Presence is inherently ephemeral (sub-minute TTL) and should remain in-memory. Persisting it to PostgreSQL would add write amplification for no durable value.

### Optional: `ticket_collision_log` table (audit only, Phase 2)

If we want to track how often collisions occur for analytics:

```sql
CREATE TABLE ticket_collision_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  user_id UUID NOT NULL REFERENCES users(id),
  collision_type TEXT NOT NULL, -- 'concurrent_reply', 'concurrent_edit', 'concurrent_view'
  other_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX collision_logs_workspace_idx ON ticket_collision_logs(workspace_id, created_at);
```

Drizzle definition:

```typescript
export const ticketCollisionLogs = pgTable(
  'ticket_collision_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    collisionType: text('collision_type').notNull(),
    otherUserId: uuid('other_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    collisionLogsWorkspaceIdx: index('collision_logs_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);
```

**Recommendation**: Skip the audit table in Phase 1. Add in Phase 2 after we know the feature is used.

---

## 3. New API Routes Needed

### 3a. Modify: `POST /api/presence` (existing)

**File**: `src/app/api/presence/route.ts`

Changes:
- Extract `userId` and `userName` from the auth session instead of trusting the request body (security fix)
- Add `workspaceId` to presence entries for multi-tenant isolation
- Accept `composingStartedAt` timestamp in typing activity for stale-compose detection
- Return current viewers in the POST response (saves a separate GET call)

```typescript
// Before: trusts userId from body
const { userId, userName, ticketId, activity, action } = await request.json();

// After: extracts from session
const { ticketId, activity, action } = await request.json();
const userId = auth.user.id;
const userName = auth.user.name;
```

### 3b. New: `GET /api/tickets/[id]/collision-check`

**File**: `src/app/api/tickets/[id]/collision-check/route.ts`

Purpose: Before submitting a reply, the client calls this to check if any new messages were created after a given timestamp.

```typescript
GET /api/tickets/{id}/collision-check?since=2026-03-05T10:30:00Z

Response:
{
  hasNewReplies: boolean,
  newReplies: Array<{
    id: string,
    author: string,
    authorType: string,
    createdAt: string,
    bodyPreview: string   // first 200 chars
  }>,
  activeViewers: Array<{
    userId: string,
    userName: string,
    activity: 'viewing' | 'typing'
  }>
}
```

### 3c. Modify: `POST /api/tickets/[id]/reply` (existing)

**File**: `src/app/api/tickets/[id]/reply/route.ts`

Changes:
- Accept optional `composingStartedAt` ISO timestamp
- If provided, check for messages created after that timestamp
- If collisions found, return `409 Conflict` with collision details instead of blindly posting
- Accept `forceSubmit: true` to override the collision warning

```typescript
// New request body fields:
{
  message: string,
  isNote?: boolean,
  composingStartedAt?: string,  // ISO timestamp when agent started typing
  forceSubmit?: boolean          // override collision warning
}

// New 409 response:
{
  error: 'collision_detected',
  newReplies: [...],
  message: 'Another agent replied while you were composing'
}
```

### 3d. Modify: `GET /api/events` (existing)

**File**: `src/app/api/events/route.ts`

Changes:
- Add optional `?ticketId=X` query parameter to filter events for a specific ticket
- Add `workspaceId` filtering based on auth session
- This allows the ticket detail page to subscribe only to relevant events

---

## 4. New/Modified UI Pages/Components

### 4a. Modify: Ticket Detail Page (`src/app/tickets/[id]/page.tsx`)

This is a server component. Changes:
- Import and render `CollisionDetector` component (currently unused)
- Pass current user info from server-side auth context
- Wrap the page in a client boundary component that manages SSE subscription

```tsx
// Add to ticket detail page, above the ticket header:
<TicketCollisionWrapper ticketId={ticket.id}>
  <CollisionDetector
    ticketId={ticket.id}
    currentUserId={session.user.id}
    currentUserName={session.user.name}
  />
  {/* existing header, conversation, actions */}
</TicketCollisionWrapper>
```

### 4b. Modify: `CollisionDetector` (`src/components/CollisionDetector.tsx`)

Current state: Polling-based, shows simple text. Needs significant enhancement.

Changes:
- **Switch from polling to SSE**: Subscribe to `/api/events?ticketId=X` instead of polling `/api/presence` every 10s. Keep a single initial GET for hydration, then rely on SSE for real-time updates.
- **Avatar pills**: Show colored avatar circles for each viewing agent, with initials inside.
- **Typing indicator**: Animated "..." when an agent's activity is `typing`.
- **Differentiated display**: Eye icon for viewing, pen icon for typing (matches Freshdesk pattern).
- **Auto-dismiss**: Remove viewers from the display when `presence:left` SSE event received.

```
┌──────────────────────────────────────────────────────┐
│ [pulse] [JD] [AS] Jane Doe is typing, Alex Smith     │
│          is viewing this ticket                       │
└──────────────────────────────────────────────────────┘
```

### 4c. Modify: `TicketActions` (`src/components/TicketActions.tsx`)

Changes:
- **Track composing start time**: Record timestamp when the textarea receives its first keystroke.
- **Broadcast typing activity**: On textarea focus/input, POST to `/api/presence` with `activity: 'typing'`. Debounce to max 1 call per 3s.
- **Broadcast stop-typing**: On textarea blur or 5s of no input, switch back to `activity: 'viewing'`.
- **Pre-submit collision check**: Before calling `/api/tickets/{id}/reply`, call `GET /api/tickets/{id}/collision-check?since={composingStartedAt}`.
- **Collision warning modal**: If collision detected, show a modal:

```
┌─────────────────────────────────────────────────┐
│  WARNING: Reply Collision Detected              │
│                                                 │
│  Jane Doe posted a reply 2 minutes ago while    │
│  you were composing.                            │
│                                                 │
│  Preview:                                       │
│  "Hi, I've already escalated this to..."        │
│                                                 │
│  [Review Their Reply]  [Send Anyway]  [Cancel]  │
└─────────────────────────────────────────────────┘
```

- **SSE-driven inline notification**: If a `ticket:reply` SSE event arrives while the reply textarea is focused, show an inline warning banner above the textarea immediately (no need to wait for submit).

### 4d. New: `TicketCollisionWrapper` (`src/components/TicketCollisionWrapper.tsx`)

Client component that:
- Establishes a single SSE connection per ticket detail page
- Distributes events to child components via React context
- Manages the EventSource lifecycle (connect, reconnect on error, close on unmount)
- Provides a `useTicketEvents()` hook for children

```typescript
interface TicketEventsContextValue {
  viewers: Viewer[];
  lastReplyEvent: AppEvent | null;
  connected: boolean;
}

const TicketEventsContext = createContext<TicketEventsContextValue>(...);
export const useTicketEvents = () => useContext(TicketEventsContext);
```

### 4e. Modify: Dashboard / Ticket List (`src/app/tickets/page.tsx`)

Low priority, Phase 2:
- Show small eye/pen icons next to tickets that have active viewers
- Requires a new API: `GET /api/presence/summary` returning `{ticketId: viewerCount}` for all active tickets

---

## 5. New CLI Commands

No new top-level CLI commands needed. Collision detection is inherently a real-time, interactive concern that applies to the GUI and (optionally) MCP agents, not batch CLI operations.

### Minor: `cliaas ticket show --presence`

**File**: `cli/commands/tickets.ts`

Add a `--presence` flag to `cliaas ticket show` that queries the presence API and displays current viewers:

```
$ cliaas ticket show TK-1234 --presence
Subject: Login page broken
Status:  open
...
Active agents: Jane Doe (typing), Alex Smith (viewing)
```

Implementation: HTTP GET to `/api/presence?ticketId=TK-1234`.

---

## 6. New MCP Tools

### 6a. `ticket_presence` (read)

**File**: `cli/mcp/tools/presence.ts` (new file)

```typescript
server.tool(
  'ticket_presence',
  'Show which agents are currently viewing or typing on a ticket',
  {
    ticketId: z.string().describe('Ticket ID'),
  },
  async ({ ticketId }) => {
    const viewers = presence.getViewers(ticketId);
    return textResult(JSON.stringify({ ticketId, viewers, count: viewers.length }));
  }
);
```

### 6b. `ticket_collision_check` (read)

```typescript
server.tool(
  'ticket_collision_check',
  'Check if new replies were added to a ticket after a given timestamp (use before replying)',
  {
    ticketId: z.string().describe('Ticket ID'),
    since: z.string().describe('ISO timestamp — check for replies after this time'),
  },
  async ({ ticketId, since }) => {
    // Load messages, filter by createdAt > since
    // Return { hasNewReplies, count, previews }
  }
);
```

### 6c. Modify: `ticket_reply` and `ticket_note`

**File**: `cli/mcp/tools/actions.ts`

Add collision awareness:
- Accept optional `since` parameter
- If provided and new replies exist, return a warning instead of executing
- Accept `forceSubmit` to override

This prevents AI agents from double-replying to tickets that a human already handled.

### Registration

**File**: `cli/mcp/tools/index.ts`

Add `registerPresenceTools(server)` to the tool registration list.

---

## 7. Migration/Rollout Plan

### Phase 1: Wire Existing Infrastructure (S effort)

**Goal**: Get the existing `CollisionDetector` component working on the ticket detail page.

1. **Fix `POST /api/presence`** to extract userId from auth session instead of trusting request body
2. **Import `CollisionDetector`** into `src/app/tickets/[id]/page.tsx`
   - Need to split the page: server component wrapper + client component inner
   - Pass session user info as props
3. **Add typing broadcast** to `TicketActions` textarea (debounced POST to `/api/presence` with `activity: 'typing'`)
4. **Reduce cleanup threshold** in `PresenceTracker` from 60s to 30s
5. **Write tests**: Unit tests for PresenceTracker, integration test for presence API

**Deliverables**: Agents see who else is viewing/typing on the same ticket. Polling-based, 10s refresh.

### Phase 2: SSE-Driven Real-Time Updates (M effort)

**Goal**: Replace polling with SSE push for instant updates.

1. **Create `TicketCollisionWrapper`** client component with EventSource connection
2. **Add ticket-scoped SSE filtering** to `GET /api/events` (filter by `ticketId` in event data)
3. **Refactor `CollisionDetector`** to consume SSE events via context instead of polling
4. **Add inline "new reply" notification** in `TicketActions` when `ticket:reply` event arrives during compose
5. **Add workspace scoping** to presence entries and SSE event stream
6. **Write tests**: SSE connection tests, collision notification tests

**Deliverables**: Instant presence updates. Agents are immediately warned when someone else replies.

### Phase 3: Submit-Time Collision Prevention (M effort)

**Goal**: Prevent duplicate replies.

1. **Create `GET /api/tickets/[id]/collision-check`** endpoint
2. **Modify `POST /api/tickets/[id]/reply`** to accept `composingStartedAt` and return 409 on collision
3. **Add collision warning modal** to `TicketActions`
4. **Add `composingStartedAt` tracking** in textarea (record timestamp on first keystroke)
5. **Create `ticket_collision_check` MCP tool**
6. **Modify `ticket_reply` MCP tool** with `since` parameter
7. **Write tests**: Collision detection logic, 409 response handling, modal rendering

**Deliverables**: Agents are warned before submitting if another reply was posted. MCP agents get collision safety.

### Phase 4: Redis Pub/Sub for Multi-Instance (S effort)

**Goal**: Presence works across multiple Next.js instances behind a load balancer.

1. **Create `src/lib/realtime/presence-redis.ts`** — Redis-backed presence using `SETEX` with 30s TTL
2. **Create `src/lib/realtime/pubsub.ts`** — Redis pub/sub for cross-instance event forwarding
3. **Modify `PresenceTracker`** to delegate to Redis when available, fall back to in-memory
4. **Modify `EventBus`** to publish to Redis channel, subscribe in each instance
5. **Graceful degradation**: `isRedisAvailable()` gates Redis features; in-memory works for single-instance
6. **Write tests**: Redis presence tests (with mock), fallback behavior tests

**Deliverables**: Full collision detection working in multi-instance deployments.

### Phase 5: Polish & Analytics (S effort)

1. **Add `ticket_collision_logs` table** and migration
2. **Log collisions** when 409 is returned or warning modal shown
3. **Add collision metrics** to analytics dashboard (collision rate, most-collided tickets)
4. **Add eye/pen icons** to ticket list view
5. **Add `--presence` flag** to `cliaas ticket show`

---

## 8. Effort Estimate

| Phase | Scope | Effort | New/Modified Files |
|-------|-------|--------|--------------------|
| Phase 1 | Wire existing components | **S** (2-3 hours) | 4 modified |
| Phase 2 | SSE-driven real-time | **M** (4-6 hours) | 3 new, 3 modified |
| Phase 3 | Submit-time collision prevention | **M** (4-6 hours) | 2 new, 3 modified |
| Phase 4 | Redis pub/sub multi-instance | **S** (2-3 hours) | 2 new, 2 modified |
| Phase 5 | Polish & analytics | **S** (2-3 hours) | 1 new migration, 3 modified |

**Total: M-L (14-21 hours across 5 phases)**

### File Change Summary

**New files (7):**
- `src/components/TicketCollisionWrapper.tsx` — SSE context provider
- `src/components/CollisionWarningModal.tsx` — submit-time warning modal
- `src/app/api/tickets/[id]/collision-check/route.ts` — pre-submit collision check
- `src/lib/realtime/presence-redis.ts` — Redis-backed presence (Phase 4)
- `src/lib/realtime/pubsub.ts` — Redis pub/sub bridge (Phase 4)
- `cli/mcp/tools/presence.ts` — MCP presence tools
- `src/db/migrations/0005_collision_logs.sql` — audit table (Phase 5)

**Modified files (10):**
- `src/app/tickets/[id]/page.tsx` — add CollisionDetector + wrapper
- `src/components/CollisionDetector.tsx` — SSE-driven, avatar pills, typing indicators
- `src/components/TicketActions.tsx` — typing broadcast, collision check on submit, warning modal
- `src/app/api/presence/route.ts` — auth-based userId, workspace scoping
- `src/app/api/events/route.ts` — ticketId filtering, workspace scoping
- `src/app/api/tickets/[id]/reply/route.ts` — 409 collision response
- `src/lib/realtime/presence.ts` — 30s TTL, workspace scoping, Redis delegation
- `src/lib/realtime/events.ts` — Redis pub/sub bridge (Phase 4)
- `cli/mcp/tools/actions.ts` — collision-aware `ticket_reply`
- `cli/mcp/tools/index.ts` — register presence tools
- `cli/commands/tickets.ts` — `--presence` flag
- `src/db/schema.ts` — `ticketCollisionLogs` table (Phase 5)

### Risk Assessment

| Risk | Mitigation |
|------|------------|
| SSE connection limits (browser max 6 per domain) | Single SSE connection shared via context; HTTP/2 raises limit |
| Memory leak from abandoned presence entries | Existing 30s cleanup interval handles this; add connection tracking |
| Race condition between collision check and reply submit | Use `composingStartedAt` as optimistic lock; 409 is advisory, not blocking |
| Redis unavailability breaking presence | Graceful degradation to in-memory; `isRedisAvailable()` gate |
| Server component page needs client interactivity | Split into server wrapper + client inner component |

### Competitive Parity Matrix

| Feature | Zendesk | Freshdesk | Help Scout | CLIaaS Phase 1 | CLIaaS Phase 3 |
|---------|---------|-----------|------------|-----------------|-----------------|
| Who is viewing | Y | Y (eye) | Y | Y | Y |
| Who is typing | Y | Y (pen) | N | Y | Y |
| Real-time updates | Y (WS) | Y (WS) | Y (WS) | Polling (10s) | SSE (instant) |
| Duplicate reply prevention | N | N | Y | N | Y (409 + modal) |
| MCP/AI agent awareness | N/A | N/A | N/A | N | Y |
| Multi-instance support | Y | Y | Y | N | Y (Phase 4) |

CLIaaS will reach **competitive parity at Phase 3** and exceed competitors at Phase 3+ by adding MCP agent collision awareness — a capability no traditional helpdesk offers.
