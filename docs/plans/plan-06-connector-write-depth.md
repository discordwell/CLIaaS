# Plan 06: Fix Connector Write-Depth Gaps Across All Upstream Adapters

**Status:** Draft
**Created:** 2026-03-05
**Effort:** L (Large) -- 8 work items across 10 connectors, new DB tables, new MCP tools, new tests

---

## 1. Summary of What Exists Today

### 1a. Connector Write Adapter Interface

The unified write interface is defined in `cli/sync/upstream-adapter.ts:1-67`. Every adapter implements `ConnectorWriteAdapter` with four methods and two capability flags:

| Method | Description |
|--------|-------------|
| `updateTicket(externalId, updates)` | Update status/priority/assignee/tags |
| `postReply(externalId, reply)` | Post a public reply |
| `postNote(externalId, note)` | Add an internal note |
| `createTicket(ticket)` | Create a new ticket |

Capability flags: `supportsUpdate: boolean`, `supportsReply: boolean` (`upstream-adapter.ts:51-54`).

### 1b. Current Adapter Capability Matrix

| Connector | supportsUpdate | supportsReply | postNote | createTicket | Notes |
|-----------|---------------|---------------|----------|-------------|-------|
| **Zendesk** | YES | YES | YES | YES | Gold standard. Full CRUD. Incremental cursor sync. |
| **Freshdesk** | YES | YES | YES | YES | Full CRUD. No incremental sync (full re-export). |
| **Groove** | YES | YES | YES | YES | Full CRUD. No incremental sync. |
| **HelpCrunch** | YES | YES | YES | YES* | *`createTicket` uses hardcoded `customerId: 0` (`helpcrunch.ts:48`). Will fail on real API. |
| **Intercom** | NO | YES | YES | YES | `updateTicket` throws. Requires `INTERCOM_ADMIN_ID` env var. No incremental sync. |
| **Help Scout** | NO | YES | YES | YES | `updateTicket` throws. Requires `HELPSCOUT_MAILBOX_ID`. No incremental sync. |
| **Zoho Desk** | NO | YES | YES | YES | `updateTicket` throws. No incremental sync. |
| **HubSpot** | NO | NO | YES | YES | Both `updateTicket` and `postReply` throw (`hubspot.ts:18-23`). No incremental sync. |
| **Kayako** | N/A | N/A | N/A | N/A | `getUpstreamAdapter` returns `null` (`index.ts:47`). Write functions exist in connector (`kayako.ts:150-201`) but no adapter wraps them. |
| **Kayako Classic** | N/A | N/A | N/A | N/A | `getUpstreamAdapter` returns `null` (`index.ts:47`). Write functions exist in connector (`kayako-classic.ts:319-434`) but no adapter wraps them. |

### 1c. Upstream Push Engine

- `cli/sync/upstream.ts:1-401`: Outbox-based engine with enqueue, push, status, and retry.
- DB table `upstream_outbox` (`src/db/schema.ts:1207-1236`): connector, operation, ticketId, externalId, payload (JSONB), status enum, retryCount (max 3).
- MCP tools: `upstream_push`, `upstream_status`, `upstream_retry` (`cli/mcp/tools/sync.ts:84-154`).
- CLI commands: `cliaas sync upstream push|status|retry` via `cli/commands/sync.ts`.

### 1d. Sync Engine (Downstream Pull)

- `cli/sync/engine.ts:68-211`: `runSyncCycle()` calls connector export functions.
- Only **Zendesk** supports incremental cursor (`cli/connectors/zendesk.ts:101,123-137` via `cursorState`). All other connectors do full re-export on every sync cycle.
- Sync worker: `cli/sync/worker.ts` runs cycles on interval (default 5 min).
- Auth: `cli/sync/auth.ts:12-77` resolves credentials from env vars for all 10 connectors.

### 1e. Existing Tests

- `cli/__tests__/sync/upstream-adapters.test.ts:1-257`: Mock-based tests for all 8 adapters (Kayako/Classic excluded since they return null).
- `cli/__tests__/connectors/crud/`: 10 CRUD test files (one per connector) -- these mock HTTP and test create/update/reply/note operations on the raw connector modules.
- `cli/__tests__/sync/upstream.test.ts`: Tests for the outbox engine (enqueue, push, dedup, retry).
- `cli/__tests__/sync/engine.test.ts`: Tests for the sync engine.

### 1f. UI

- `src/components/ConnectorCard.tsx:1-178`: Shows env var status, export counts, "Verify Connection" and "Pull Data" buttons. Hardcoded "bidirectional" badge on all connectors. No write capability display.
- `src/lib/connector-service.ts:1-79`: `ConnectorMeta` type has no write-capability fields.

---

## 2. Proposed DB Schema Changes

### 2a. New Table: `connector_capabilities`

Machine-readable feature flags per connector, queryable by sync health monitor and UI.

```sql
CREATE TABLE connector_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector TEXT NOT NULL,
  supports_read BOOLEAN NOT NULL DEFAULT TRUE,
  supports_incremental_sync BOOLEAN NOT NULL DEFAULT FALSE,
  supports_update BOOLEAN NOT NULL DEFAULT FALSE,
  supports_reply BOOLEAN NOT NULL DEFAULT FALSE,
  supports_note BOOLEAN NOT NULL DEFAULT FALSE,
  supports_create BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  UNIQUE(workspace_id, connector)
);
```

Drizzle definition in `src/db/schema.ts`:

```ts
export const connectorCapabilities = pgTable(
  'connector_capabilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    connector: text('connector').notNull(),
    supportsRead: boolean('supports_read').notNull().default(true),
    supportsIncrementalSync: boolean('supports_incremental_sync').notNull().default(false),
    supportsUpdate: boolean('supports_update').notNull().default(false),
    supportsReply: boolean('supports_reply').notNull().default(false),
    supportsNote: boolean('supports_note').notNull().default(false),
    supportsCreate: boolean('supports_create').notNull().default(false),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  },
  table => ({
    connectorCapabilitiesUniqueIdx: uniqueIndex('connector_capabilities_unique_idx')
      .on(table.workspaceId, table.connector),
  }),
);
```

### 2b. New Table: `sync_health`

Track sync health per connector for staleness detection, failure monitoring, and data drift.

```sql
CREATE TABLE sync_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('pull', 'push')),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_syncs INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  last_record_count INTEGER,
  cursor_state JSONB,
  stale BOOLEAN NOT NULL DEFAULT FALSE,
  stale_since TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, connector, direction)
);
```

Drizzle definition:

```ts
export const syncHealth = pgTable(
  'sync_health',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    connector: text('connector').notNull(),
    direction: text('direction').notNull(), // 'pull' | 'push'
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    totalSyncs: integer('total_syncs').notNull().default(0),
    totalFailures: integer('total_failures').notNull().default(0),
    lastRecordCount: integer('last_record_count'),
    cursorState: jsonb('cursor_state'),
    stale: boolean('stale').notNull().default(false),
    staleSince: timestamp('stale_since', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    syncHealthUniqueIdx: uniqueIndex('sync_health_unique_idx')
      .on(table.workspaceId, table.connector, table.direction),
  }),
);
```

### 2c. New Column on `upstream_outbox`

No new columns needed. The existing schema is sufficient.

---

## 3. New API Routes Needed

### 3a. `GET /api/connectors/[name]/capabilities`

Returns the machine-readable capability matrix for a single connector. Falls back to static defaults if no DB row exists.

**Response:**
```json
{
  "connector": "hubspot",
  "capabilities": {
    "read": true,
    "incrementalSync": false,
    "update": true,
    "reply": true,
    "note": true,
    "create": true
  },
  "lastVerifiedAt": "2026-03-05T10:00:00Z"
}
```

### 3b. `GET /api/connectors/capabilities`

Returns the full capability matrix for all connectors. Used by the connectors settings page.

**Response:**
```json
{
  "connectors": [
    { "name": "zendesk", "read": true, "incrementalSync": true, "update": true, "reply": true, "note": true, "create": true },
    { "name": "hubspot", "read": true, "incrementalSync": false, "update": true, "reply": true, "note": true, "create": true }
  ]
}
```

### 3c. `GET /api/sync/health`

Returns sync health for all connectors (or filtered by query param).

**Response:**
```json
{
  "health": [
    {
      "connector": "zendesk",
      "pull": { "lastSuccess": "...", "consecutiveFailures": 0, "stale": false },
      "push": { "lastSuccess": "...", "consecutiveFailures": 0, "pending": 3, "failed": 0 }
    }
  ]
}
```

### 3d. `GET /api/sync/health/[connector]`

Returns detailed sync health for a single connector, including cursor state, last error, and record counts.

---

## 4. New/Modified UI Pages/Components

### 4a. Modified: `ConnectorCard.tsx`

**Current:** Hardcoded "bidirectional" badge on all connectors (`ConnectorCard.tsx:71`).

**Changes:**
1. Replace hardcoded "bidirectional" badge with dynamic capability badges based on the capability matrix.
2. Show individual badges: "read", "write", "incremental", or a summary like "read-only" / "full sync" / "bidirectional".
3. Add sync health indicator (green/yellow/red dot) next to each connector based on `sync_health` data.
4. Add "Push Changes" button (alongside "Pull Data") that triggers `upstream_push` for that connector, only shown when the connector has write capabilities.

**New props on `ConnectorMeta`:**
```ts
interface ConnectorMeta {
  // ... existing fields ...
  capabilities: {
    read: boolean;
    incrementalSync: boolean;
    update: boolean;
    reply: boolean;
    note: boolean;
    create: boolean;
  };
  health?: {
    pullStatus: 'healthy' | 'stale' | 'failing';
    pushStatus: 'healthy' | 'idle' | 'failing';
    pendingPushCount: number;
  };
}
```

### 4b. Modified: Connectors Settings Page

Add a summary "Connector Capability Matrix" table at the top of the connectors page showing all 10 connectors and their read/write/incremental capabilities at a glance.

### 4c. New: Sync Health Dashboard Widget

A small component on the admin dashboard showing:
- Number of connectors with stale data (no successful pull in >24h)
- Number of failed upstream pushes pending retry
- Number of pending outbox entries

---

## 5. New CLI Commands

### 5a. `cliaas sync health [--connector <name>]`

Show sync health for all or a specific connector. Output:

```
CONNECTOR    DIRECTION  LAST SUCCESS      FAILURES  STALE
zendesk      pull       2 minutes ago     0         no
zendesk      push       5 minutes ago     0         no
hubspot      pull       3 hours ago       0         yes (stale >1h)
hubspot      push       never             -         -
kayako       pull       never             -         not configured
```

### 5b. `cliaas connector capabilities [--connector <name>]`

Show the write capability matrix.

```
CONNECTOR       READ  INCR  UPDATE  REPLY  NOTE  CREATE
zendesk         yes   yes   yes     yes    yes   yes
freshdesk       yes   no    yes     yes    yes   yes
hubspot         yes   no    yes     yes    yes   yes
kayako          yes   no    yes     yes    yes   yes
kayako-classic  yes   no    yes     yes    yes   yes
```

### 5c. No new CLI commands needed for the write-depth fixes

The existing `cliaas sync upstream push|status|retry` commands continue to work. The fixes are in the adapter implementations, not the CLI surface.

---

## 6. New MCP Tools

### 6a. `sync_health`

```
Tool: sync_health
Description: Show sync health status for connectors (staleness, failure counts, last sync times)
Parameters:
  connector?: string  -- Filter by connector name
Returns:
  Array of { connector, direction, lastSuccess, consecutiveFailures, stale, pendingPush }
```

### 6b. `connector_capabilities`

```
Tool: connector_capabilities
Description: Show the read/write capability matrix for all connectors
Parameters:
  connector?: string  -- Filter by connector name
Returns:
  Array of { connector, read, incrementalSync, update, reply, note, create }
```

These would be added to `cli/mcp/tools/sync.ts` alongside the existing sync tools.

---

## 7. Detailed Work Items

### WI-1: HubSpot -- Implement `updateTicket` and `postReply`

**Files to modify:**
- `cli/connectors/hubspot.ts` -- Add two new write functions
- `cli/sync/upstream-adapters/hubspot.ts` -- Enable `supportsUpdate: true` and `supportsReply: true`
- `cli/__tests__/sync/upstream-adapters.test.ts` -- Update HubSpot tests
- `cli/__tests__/connectors/crud/hubspot.crud.test.ts` -- Add CRUD tests for new functions

**Implementation details:**

`hubspotUpdateTicket()` -- Uses HubSpot CRM API `PATCH /crm/v3/objects/tickets/{ticketId}`:
```ts
export async function hubspotUpdateTicket(
  auth: HubSpotAuth,
  ticketId: string,
  updates: {
    status?: string;       // maps to hs_pipeline_stage
    priority?: string;     // maps to hs_ticket_priority
    ownerId?: string;      // maps to hubspot_owner_id
    subject?: string;      // maps to subject
  },
): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (updates.status) properties.hs_pipeline_stage = updates.status;
  if (updates.priority) properties.hs_ticket_priority = updates.priority;
  if (updates.ownerId) properties.hubspot_owner_id = updates.ownerId;
  if (updates.subject) properties.subject = updates.subject;

  await createHubSpotClient(auth).request(`/crm/v3/objects/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { properties },
  });
}
```

`hubspotPostReply()` -- HubSpot does not have a native "reply" concept on tickets. The closest equivalent is creating an Email engagement associated with the ticket:
```ts
export async function hubspotPostReply(
  auth: HubSpotAuth,
  ticketId: string,
  body: string,
  options?: { ownerId?: string },
): Promise<{ id: string }> {
  const client = createHubSpotClient(auth);
  const properties: Record<string, unknown> = {
    hs_email_direction: 'EMAIL',
    hs_email_status: 'SENT',
    hs_email_subject: 'Reply',
    hs_email_text: body,
    hs_timestamp: new Date().toISOString(),
  };
  if (options?.ownerId) properties.hubspot_owner_id = options.ownerId;

  const email = await client.request<{ id: string }>('/crm/v3/objects/emails', {
    method: 'POST',
    body: { properties },
  });

  // Associate email with ticket
  await client.request(`/crm/v4/objects/emails/${email.id}/associations/tickets/${ticketId}`, {
    method: 'PUT',
    body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 26 }],
  });

  return { id: email.id };
}
```

**Adapter changes** (`cli/sync/upstream-adapters/hubspot.ts`):
- Set `supportsUpdate: true`, `supportsReply: true`
- Replace `throw` stubs with calls to `hubspotUpdateTicket` and `hubspotPostReply`
- Add status/priority mapping (HubSpot uses pipeline stages and text priorities)

**Effort:** M

---

### WI-2: Kayako Modern -- Implement Upstream Adapter

**Files to create/modify:**
- `cli/sync/upstream-adapters/kayako.ts` -- New file
- `cli/sync/upstream-adapters/index.ts` -- Add Kayako to the switch statement
- `cli/__tests__/sync/upstream-adapters.test.ts` -- Add Kayako tests (remove "returns null for kayako" test)

**Implementation details:**

Write functions already exist in `cli/connectors/kayako.ts:150-201`:
- `kayakoUpdateCase(auth, caseId, updates)` -- PATCH `/api/v1/cases/{id}.json`
- `kayakoPostReply(auth, caseId, contents)` -- POST `/api/v1/cases/{id}/reply.json`
- `kayakoPostNote(auth, caseId, bodyText)` -- POST `/api/v1/cases/{id}/notes.json`
- `kayakoCreateCase(auth, subject, contents, opts)` -- POST `/api/v1/cases.json`

The adapter just needs to wrap these:

```ts
export function createKayakoAdapter(auth: Record<string, string>): ConnectorWriteAdapter {
  const kyAuth = { domain: auth.domain, email: auth.email, password: auth.password };
  return {
    name: 'kayako',
    supportsUpdate: true,
    supportsReply: true,
    async updateTicket(externalId, updates) {
      const { kayakoUpdateCase } = await import('../../connectors/kayako.js');
      const mapped: Record<string, unknown> = {};
      if (updates.status) mapped.status = updates.status;
      if (updates.priority) mapped.priority = updates.priority;
      if (updates.tags) mapped.tags = updates.tags;
      await kayakoUpdateCase(kyAuth, Number(externalId), mapped);
    },
    async postReply(externalId, reply) {
      const { kayakoPostReply: kyPostReply } = await import('../../connectors/kayako.js');
      await kyPostReply(kyAuth, Number(externalId), reply.body);
    },
    async postNote(externalId, note) {
      const { kayakoPostNote: kyPostNote } = await import('../../connectors/kayako.js');
      await kyPostNote(kyAuth, Number(externalId), note.body);
    },
    async createTicket(ticket) {
      const { kayakoCreateCase } = await import('../../connectors/kayako.js');
      const result = await kayakoCreateCase(kyAuth, ticket.subject, ticket.description, { tags: ticket.tags });
      return { externalId: String(result.id) };
    },
  };
}
```

**Effort:** S

---

### WI-3: Kayako Classic -- Implement Upstream Adapter

**Files to create/modify:**
- `cli/sync/upstream-adapters/kayako-classic.ts` -- New file
- `cli/sync/upstream-adapters/index.ts` -- Add Kayako Classic to the switch statement
- `cli/__tests__/sync/upstream-adapters.test.ts` -- Add Kayako Classic tests (remove "returns null for kayako-classic" test)

**Implementation details:**

Write functions already exist in `cli/connectors/kayako-classic.ts:319-434`:
- `kayakoClassicUpdateTicket(auth, ticketId, updates)` -- PUT `/Tickets/Ticket/{id}`
- `kayakoClassicPostReply(auth, ticketId, contents, staffId?)` -- POST `/Tickets/TicketPost/Ticket/{id}`
- `kayakoClassicPostNote(auth, ticketId, contents, staffId?)` -- POST `/Tickets/TicketNote/Ticket/{id}`
- `kayakoClassicCreateTicket(auth, subject, contents, opts)` -- POST `/Tickets/Ticket`

**Caveat:** Kayako Classic's `createTicket` requires a `departmentid` which is not available in the generic `UpstreamTicketCreate` payload. The adapter should:
1. Check for `KAYAKO_CLASSIC_DEPARTMENT_ID` env var as a default.
2. If not set, throw a clear error explaining the requirement.

Similarly, `updateTicket` uses numeric status/priority IDs, not labels. The adapter should maintain a local mapping or require `KAYAKO_CLASSIC_STATUS_MAP` / `KAYAKO_CLASSIC_PRIORITY_MAP` config, OR accept that status/priority strings may not map perfectly (best-effort).

**Note:** Per CLAUDE.md, Kayako Classic will remain unconfigured (no active accounts). However, having the adapter exist (even if untestable live) ensures feature completeness and prevents the "No upstream adapter" skip in the push engine.

**Effort:** S

---

### WI-4: HelpCrunch -- Fix `customerId` Resolution

**Files to modify:**
- `cli/sync/upstream-adapters/helpcrunch.ts:45-49` -- Fix `createTicket`
- `cli/connectors/helpcrunch.ts:275-288` -- Add customer lookup function
- `cli/__tests__/connectors/crud/helpcrunch.crud.test.ts` -- Test customer resolution

**Current problem:**
```ts
// helpcrunch.ts adapter, line 48:
const result = await helpcrunchCreateChat(hcAuth, 0, ticket.description);
// customerId 0 is a placeholder that will likely fail on the real API
```

**Fix:**

Add a customer lookup function in the connector:
```ts
export async function helpcrunchFindCustomerByEmail(
  auth: HelpcrunchAuth,
  email: string,
): Promise<number | null> {
  const client = createHelpcrunchClient(auth);
  const result = await client.request<{ data: Array<{ id: number }> }>(
    '/customers/search',
    {
      method: 'POST',
      body: { filter: { emails: [email] } },
    },
  );
  return result.data[0]?.id ?? null;
}
```

Update the adapter's `createTicket`:
```ts
async createTicket(ticket) {
  const { helpcrunchCreateChat, helpcrunchFindCustomerByEmail } = await import('../../connectors/helpcrunch.js');
  let customerId = 0;
  if (ticket.requester) {
    const found = await helpcrunchFindCustomerByEmail(hcAuth, ticket.requester);
    if (found) customerId = found;
  }
  if (customerId === 0) {
    throw new Error('HelpCrunch requires a valid customerId. Provide a requester email that exists in HelpCrunch.');
  }
  const result = await helpcrunchCreateChat(hcAuth, customerId, ticket.description);
  return { externalId: String(result.id) };
}
```

**Effort:** S

---

### WI-5: Incremental Sync for 8 Non-Zendesk Connectors

**Context:** Today only Zendesk supports incremental sync. The remaining 9 connectors do full re-export every cycle. This is the most complex work item.

**Approach:** Not all APIs support cursor-based incremental export. We need a per-connector assessment:

| Connector | API Support for Incremental | Approach |
|-----------|----------------------------|----------|
| **Freshdesk** | `updated_since` filter param on `/api/v2/tickets` | Pass `cursorState.lastUpdated` as `updated_since` param. Store `max(updated_at)` in cursor. |
| **Intercom** | Conversations support `updated_after` in search | Use `/conversations/search` with `updated_at > cursor`. |
| **Help Scout** | `modifiedSince` query param on conversations | Pass `cursorState.modifiedSince` param. |
| **Zoho Desk** | `modifiedTimeRange` filter on tickets | Use `modifiedTime` range filter with cursor. |
| **HubSpot** | `after` cursor on all CRM objects | Already uses cursor pagination per-request but doesn't persist across syncs. Store `after` cursor. |
| **Groove** | No native incremental API | **Keep full re-export.** Groove API is rate-limited (2500ms pre-request delay) and has no modified-since filter. |
| **HelpCrunch** | No documented `modifiedSince` filter | **Keep full re-export.** Could potentially filter by chat `lastMessageAt` but API doesn't expose a modified-since filter. |
| **Kayako** | `updated_after` param on cases | Use `cursorState.lastUpdated` as `updated_after` param. |
| **Kayako Classic** | No native incremental API; list endpoint pagination only | **Keep full re-export.** Legacy XML API has no modified-since support. |

**Files to modify per connector:**
- `cli/connectors/{connector}.ts` -- Accept `cursorState` param, filter by last-modified, return updated cursor
- `cli/sync/engine.ts:99-186` -- Pass `cursorState` to each connector's export function (currently only Zendesk receives it)

**Implementation pattern (using Freshdesk as example):**

```ts
// freshdesk.ts -- Change signature:
export async function exportFreshdesk(
  auth: FreshdeskAuth,
  outDir: string,
  cursorState?: Record<string, string>,  // NEW
): Promise<ExportManifest> {
  // ...
  const newCursorState: Record<string, string> = { ...cursorState };

  // Tickets: use updated_since if cursor available
  const ticketPath = cursorState?.ticketUpdatedSince
    ? `/api/v2/tickets?updated_since=${cursorState.ticketUpdatedSince}`
    : '/api/v2/tickets';

  // Track max updated_at
  let maxUpdatedAt = cursorState?.ticketUpdatedSince ?? '';

  await paginatePages<FDTicket>({
    // ... existing code ...
    onPage: async (tickets) => {
      for (const t of tickets) {
        if (t.updated_at > maxUpdatedAt) maxUpdatedAt = t.updated_at;
        // ... existing mapping code ...
      }
    },
  });

  newCursorState.ticketUpdatedSince = maxUpdatedAt;

  return writeManifest(outDir, 'freshdesk', counts, { cursorState: newCursorState });
}
```

**Engine changes** (`cli/sync/engine.ts`):
```ts
// For each connector case, pass cursorState (currently only zendesk does):
case 'freshdesk': {
  manifest = await exportFreshdesk(
    { subdomain: auth.domain, apiKey: auth.apiKey },
    outDir,
    cursorState,  // NEW
  );
  break;
}
```

**Effort:** L (touches 6 connector files + engine, needs careful per-API testing)

---

### WI-6: Sync Health Monitoring

**Files to create/modify:**
- `src/db/schema.ts` -- Add `syncHealth` table
- `cli/sync/health.ts` -- New module with health tracking functions
- `cli/sync/engine.ts` -- Call health recorder after each sync cycle
- `cli/sync/upstream.ts` -- Call health recorder after each push cycle
- `cli/commands/sync.ts` -- Add `cliaas sync health` subcommand
- `cli/mcp/tools/sync.ts` -- Add `sync_health` MCP tool
- `src/app/api/sync/health/route.ts` -- New API route

**Core functions in `cli/sync/health.ts`:**

```ts
export async function recordSyncResult(params: {
  connector: string;
  direction: 'pull' | 'push';
  success: boolean;
  error?: string;
  recordCount?: number;
  cursorState?: Record<string, string>;
}): Promise<void>;

export async function getSyncHealth(connector?: string): Promise<SyncHealthRecord[]>;

export async function detectStaleConnectors(staleSinceMinutes?: number): Promise<string[]>;
```

**Staleness detection rules:**
- A connector is "stale" if its last successful pull was more than `staleSinceMinutes` ago (default: 60 for connectors with active sync workers, 1440 for others).
- A connector is "failing" if it has 3+ consecutive failures.
- A connector is "idle" if it has never been synced.

**Effort:** M

---

### WI-7: Connector Capability Matrix

**Files to create/modify:**
- `src/db/schema.ts` -- Add `connectorCapabilities` table
- `cli/sync/capabilities.ts` -- New module with static defaults + DB override logic
- `cli/sync/upstream-adapters/index.ts` -- Export static capabilities map
- `cli/mcp/tools/sync.ts` -- Add `connector_capabilities` MCP tool
- `cli/commands/sync.ts` -- Add `cliaas connector capabilities` subcommand
- `src/lib/connector-service.ts` -- Add capabilities to `ConnectorMeta`
- `src/components/ConnectorCard.tsx` -- Show capabilities badges
- `src/app/api/connectors/capabilities/route.ts` -- New API route

**Static defaults** (defined in code, overridable via DB):

```ts
export const CONNECTOR_CAPABILITIES: Record<string, ConnectorCapability> = {
  zendesk:         { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  freshdesk:       { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  groove:          { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  helpcrunch:      { read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
  intercom:        { read: true, incrementalSync: true,  update: false, reply: true,  note: true,  create: true  },
  helpscout:       { read: true, incrementalSync: true,  update: false, reply: true,  note: true,  create: true  },
  'zoho-desk':     { read: true, incrementalSync: true,  update: false, reply: true,  note: true,  create: true  },
  hubspot:         { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  kayako:          { read: true, incrementalSync: true,  update: true,  reply: true,  note: true,  create: true  },
  'kayako-classic':{ read: true, incrementalSync: false, update: true,  reply: true,  note: true,  create: true  },
};
```

Note: These reflect the **target state after all WIs are complete.** The `incrementalSync` flags match the assessment in WI-5.

**Effort:** M

---

### WI-8: Integration Tests

**Files to create:**
- `cli/__tests__/sync/upstream-adapters-kayako.test.ts` -- Mock-based tests for new Kayako adapter
- `cli/__tests__/sync/upstream-adapters-kayako-classic.test.ts` -- Mock-based tests for new Kayako Classic adapter
- `cli/__tests__/connectors/crud/helpcrunch-customer-lookup.test.ts` -- Test customer-by-email lookup
- `cli/__tests__/sync/health.test.ts` -- Test sync health recording and staleness detection
- `cli/__tests__/sync/capabilities.test.ts` -- Test capability matrix resolution

**Existing tests to update:**
- `cli/__tests__/sync/upstream-adapters.test.ts` -- Remove "returns null for kayako/kayako-classic" tests; add capability flag assertions for HubSpot (now true/true); update mock for `hubspotUpdateTicket` and `hubspotPostReply`
- `cli/__tests__/connectors/crud/hubspot.crud.test.ts` -- Add tests for `hubspotUpdateTicket` and `hubspotPostReply`
- `cli/__tests__/sync/engine.test.ts` -- Test that cursorState is passed through for newly-incremental connectors

**Test strategy:**
- All adapter tests use `vi.mock()` to prevent real HTTP calls
- CRUD tests use `vi.spyOn(globalThis, 'fetch')` to mock responses
- Health tests use in-memory DB mocks
- No live API tests in CI (guard behind `LIVE_TESTS=1`)

**Effort:** M

---

## 8. Migration/Rollout Plan

### Phase 1: Write-Depth Fixes (WI-1 through WI-4) -- Week 1

**Order:** WI-2 (Kayako adapter), WI-3 (Kayako Classic adapter), WI-4 (HelpCrunch fix), WI-1 (HubSpot)

Rationale: WI-2 and WI-3 are trivial (wiring existing functions); WI-4 is a small fix; WI-1 requires the most API research (HubSpot Conversations API).

**Migration:**
- No DB migrations needed for Phase 1
- Backward compatible: adapters that previously returned null now return adapters; adapters that threw now work
- Outbox entries previously marked "skipped" for Kayako/Classic will now be processed on next push

**Testing gate:** All existing tests pass + new adapter tests pass.

### Phase 2: Capability Matrix + Health Monitoring (WI-6, WI-7) -- Week 2

**Order:** WI-7 (capabilities), WI-6 (health)

**Migration:**
- DB migration: Add `connector_capabilities` and `sync_health` tables
- Seed `connector_capabilities` with static defaults on first run
- Health recording is additive -- no breaking changes

**Rollout:**
1. Run migration: `cliaas db migrate`
2. Seed capabilities: automatic on first `sync_health` query
3. UI updates deploy with the code

### Phase 3: Incremental Sync (WI-5) -- Week 3-4

**Order:** Start with Freshdesk (simplest API), then HubSpot, Intercom, Help Scout, Zoho Desk, Kayako. Skip Groove, HelpCrunch, Kayako Classic (no API support).

**Migration:**
- No DB migration needed (cursor state stored in manifest.json)
- Backward compatible: connectors ignore cursorState if not provided
- First sync after upgrade will be a full sync (no existing cursor); subsequent syncs will be incremental

**Rollout:**
1. Deploy updated connector code
2. Run `cliaas sync run --connector freshdesk` to verify incremental behavior
3. Enable for remaining connectors one at a time
4. Monitor via `cliaas sync health`

### Phase 4: Integration Tests (WI-8) -- Throughout

Tests are written alongside each work item, not as a separate phase. Listed as WI-8 for completeness.

---

## 9. Effort Estimate

| Work Item | Description | Size | Est. Hours |
|-----------|-------------|------|------------|
| WI-1 | HubSpot: updateTicket + postReply | M | 6-8h |
| WI-2 | Kayako: upstream adapter | S | 2-3h |
| WI-3 | Kayako Classic: upstream adapter | S | 2-3h |
| WI-4 | HelpCrunch: customerId fix | S | 2-3h |
| WI-5 | Incremental sync (6 connectors) | L | 16-24h |
| WI-6 | Sync health monitoring | M | 8-10h |
| WI-7 | Connector capability matrix | M | 6-8h |
| WI-8 | Integration tests (all items) | M | 8-10h |
| **TOTAL** | | **L** | **50-69h** |

**Overall size: L (Large)**

---

## 10. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| HubSpot Conversations API may not map cleanly to "reply" concept | Medium | Fall back to Email engagement + ticket association. Document limitation. |
| Kayako/Classic adapters untestable (no active accounts) | Low | Mock-based tests only. Adapters are thin wrappers around existing write functions that are already tested in CRUD tests. |
| Incremental sync may miss records if API clock skew exists | Medium | Use conservative cursor (subtract 60s from max updated_at). Run periodic full sync (e.g., weekly) to catch drift. |
| HelpCrunch customer search API may not support email filter | Medium | Fall back to listing all customers and filtering client-side. Document the limitation. |
| Rate limiting during incremental sync transition (first full + subsequent incremental) | Low | Existing retry/backoff in connector base client handles this. |

---

## 11. Success Criteria

After all work items are complete:

1. **All 10 connectors have upstream write adapters** -- `getUpstreamAdapter()` returns a non-null adapter for every connector.
2. **HubSpot supports update and reply** -- `supportsUpdate: true`, `supportsReply: true`.
3. **HelpCrunch createTicket resolves customerId** -- No more hardcoded `0`.
4. **6 connectors have incremental sync** -- Freshdesk, HubSpot, Intercom, Help Scout, Zoho Desk, Kayako.
5. **Sync health is tracked and queryable** -- CLI, MCP, and API can all report connector health.
6. **Capability matrix is machine-readable** -- Both static (code) and dynamic (DB) sources.
7. **ConnectorCard shows accurate capability badges** -- No more hardcoded "bidirectional" on all connectors.
8. **All existing tests pass + new tests added** -- Minimum 20 new test cases across all work items.

---

## Appendix A: File Reference

### Files to Modify

| File | Lines | Changes |
|------|-------|---------|
| `cli/sync/upstream-adapter.ts` | 1-67 | No changes needed (interface is sufficient) |
| `cli/sync/upstream-adapters/index.ts` | 1-49 | Add kayako + kayako-classic cases |
| `cli/sync/upstream-adapters/hubspot.ts` | 1-44 | Enable supportsUpdate/Reply, replace throw stubs |
| `cli/sync/upstream-adapters/helpcrunch.ts` | 45-49 | Fix createTicket customerId resolution |
| `cli/connectors/hubspot.ts` | 332-373 | Add hubspotUpdateTicket, hubspotPostReply |
| `cli/connectors/helpcrunch.ts` | 275-288 | Add helpcrunchFindCustomerByEmail |
| `cli/sync/engine.ts` | 99-186 | Pass cursorState to all connector exports |
| `cli/connectors/freshdesk.ts` | 102 | Accept cursorState param |
| `cli/connectors/intercom.ts` | 121 | Accept cursorState param |
| `cli/connectors/helpscout.ts` | 165 | Accept cursorState param |
| `cli/connectors/zoho-desk.ts` | 124 | Accept cursorState param |
| `cli/connectors/hubspot.ts` | 145 | Accept cursorState param |
| `cli/connectors/kayako.ts` | 237 | Accept cursorState param |
| `src/db/schema.ts` | ~1240 | Add connectorCapabilities + syncHealth tables |
| `cli/mcp/tools/sync.ts` | 1-224 | Add sync_health + connector_capabilities tools |
| `cli/commands/sync.ts` | | Add sync health + connector capabilities subcommands |
| `src/components/ConnectorCard.tsx` | 1-178 | Dynamic capability badges, health indicator, push button |
| `src/lib/connector-service.ts` | 1-79 | Add capabilities + health to ConnectorMeta |
| `cli/__tests__/sync/upstream-adapters.test.ts` | 1-257 | Update HubSpot expectations, add Kayako tests |
| `ARCHITECTURE.md` | ~453-464 | Update upstream sync section with new capabilities |

### Files to Create

| File | Purpose |
|------|---------|
| `cli/sync/upstream-adapters/kayako.ts` | Kayako upstream write adapter |
| `cli/sync/upstream-adapters/kayako-classic.ts` | Kayako Classic upstream write adapter |
| `cli/sync/health.ts` | Sync health monitoring module |
| `cli/sync/capabilities.ts` | Connector capability matrix module |
| `src/app/api/connectors/capabilities/route.ts` | Capability matrix API |
| `src/app/api/sync/health/route.ts` | Sync health API |
| `cli/__tests__/sync/health.test.ts` | Health monitoring tests |
| `cli/__tests__/sync/capabilities.test.ts` | Capability matrix tests |
