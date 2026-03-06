# Plan 20: Jira/Linear Integration, Deep CRM Sync, Custom Objects

> Agent 20 of 20 — Competitive gap analysis and implementation plan

---

## 1. Summary of What Exists Today

### Integration Infrastructure

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| `providerEnum` | `src/db/schema.ts` | 21-32 | 10 helpdesk providers (zendesk, freshdesk, hubspot, etc.) — no Jira, Linear, Salesforce |
| `integrations` table | `src/db/schema.ts` | 570-588 | Tracks workspace integrations with provider, status, credentials ref, metadata. Scoped to `providerEnum` values only. |
| `external_objects` table | `src/db/schema.ts` | 590-610 | Maps external IDs to internal IDs by integration + objectType. Used for sync dedup. |
| `sync_cursors` table | `src/db/schema.ts` | 612-629 | Stores per-integration, per-objectType cursor for incremental sync. |
| `raw_records` table | `src/db/schema.ts` | 663-682 | Stores raw JSON payloads from external systems for debugging/replay. |
| `upstream_outbox` table | `src/db/schema.ts` | 1184-1213 | Queues changes to push back to source helpdesk platforms. |
| `sync_outbox` table | `src/db/schema.ts` | 954-978 | Queues local changes for hybrid push to hosted API. |
| `sync_conflicts` table | `src/db/schema.ts` | 982-1007 | Tracks conflicts between local and hosted data. |
| `ConnectorRegistry` | `src/lib/connector-registry.ts` | 1-167 | Registry of 10 helpdesk connectors with IDs, prefixes, env keys. No CRM or engineering tool entries. |

### HubSpot Connector (Ticket Sync Only)

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| HubSpot export | `cli/connectors/hubspot.ts` | 145-304 | Exports tickets, contacts (as customers), owners (as agents), companies (as orgs). No deals/opportunities. |
| HubSpot write ops | `cli/connectors/hubspot.ts` | 334-373 | `hubspotCreateTicket`, `hubspotCreateNote` — ticket-focused only. |
| HubSpot verify | `cli/connectors/hubspot.ts` | 309-330 | Verifies connection with portal ID and owner count. |

### Custom Fields (Not Custom Objects)

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| `customFields` table | `src/db/schema.ts` | 408-417 | Per-workspace custom fields with objectType, name, fieldType, options. Flat fields, not object definitions. |
| `customFieldValues` table | `src/db/schema.ts` | 419-432 | EAV pattern: objectType + objectId + fieldId -> value (JSONB). |
| JSONL custom fields | `src/lib/custom-fields.ts` | 1-247 | In-memory/JSONL custom field + form management. Types: text, number, select, checkbox, date. No relationships, no custom object types. |
| Custom fields API | `src/app/api/custom-fields/route.ts` | — | CRUD for custom fields (not custom objects). |

### Customer Data Model

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| `customers` table | `src/db/schema.ts` | 199-229 | Core customer record with enrichment fields (customAttributes JSONB, avatar, locale, browser, etc.). No CRM links. |
| `organizations` table | `src/db/schema.ts` | 181-197 | Simple org with name + domains. No CRM mapping columns. |
| Customer detail page | `src/app/customers/[id]/page.tsx` | 1-209 | Shows activities + notes. No CRM sidebar, no linked deals/opportunities. |

### Ticket Detail Page

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| Ticket detail | `src/app/tickets/[id]/page.tsx` | 1-207 | Shows conversation thread, status/priority, tags, assignee. No Jira/Linear link section, no sidebar for external references. |
| `TicketActions` component | `src/components/TicketActions.tsx` | 1-165 | Reply/note composer + status/priority updater. No "Link to Jira" or "Create Issue" actions. |

### MCP Tools

| Tool Module | File | Tool Count | Relevant Tools |
|-------------|------|-----------|----------------|
| Actions | `cli/mcp/tools/actions.ts` | 7 | ticket_update, ticket_reply, ticket_note, ticket_create — all auto-enqueue upstream for helpdesk connectors. No Jira/Linear awareness. |
| Sync | `cli/mcp/tools/sync.ts` | 8 | sync_status, sync_trigger, upstream_push/status/retry, sync_pull/push/conflicts — all helpdesk-focused. |
| Customers | `cli/mcp/tools/customers.ts` | 4 | customer_show, customer_timeline, customer_note, customer_merge — no CRM data surfaced. |

### Integrations UI

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| Integrations Hub | `src/app/integrations/page.tsx` | 1-1011 | 4 tabs: Webhooks, Slack/Teams, Plugins, API. No Jira/Linear/CRM section. |

### Key Gaps

1. **No Jira/Linear** — no tables, no connectors, no API, no UI, no MCP tools.
2. **No deep CRM sync** — HubSpot connector does ticket-level export only; no contact/deal/opportunity linking to CLIaaS customers. No Salesforce connector at all.
3. **No custom objects** — `customFields`/`customFieldValues` provide EAV for adding fields to existing object types, but there is no way to define entirely new object types with schemas, instances, and relationships.
4. **`providerEnum`** is limited to helpdesk providers — adding Jira, Linear, Salesforce requires extending it or creating a separate enum for non-helpdesk integrations.

---

## 2. Proposed DB Schema Changes

### 2A. New Enum: `integration_provider_type`

The existing `providerEnum` is hardcoded to helpdesk providers and used as a column type on `tickets.source`, `rules.source`, `kbArticles.source`, and `integrations.provider`. Rather than polluting that enum with non-helpdesk values, introduce a new broader enum for the `integrations` table and new link tables.

```sql
-- New enum for all integration provider types (superset of helpdesk providers)
CREATE TYPE integration_provider AS ENUM (
  -- Helpdesk (existing)
  'zendesk', 'kayako', 'kayako-classic', 'helpcrunch', 'freshdesk',
  'groove', 'intercom', 'helpscout', 'zoho-desk', 'hubspot',
  -- Engineering
  'jira', 'linear', 'github',
  -- CRM
  'salesforce', 'hubspot-crm',
  -- Future
  'snowflake', 'stripe'
);
```

### 2B. New Table: `ticket_external_links`

Links CLIaaS tickets to external issues (Jira, Linear, GitHub).

```ts
export const ticketExternalLinks = pgTable(
  'ticket_external_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'jira' | 'linear' | 'github'
    externalId: text('external_id').notNull(), // e.g., 'PROJ-123' or linear UUID
    externalUrl: text('external_url').notNull(), // clickable link
    externalStatus: text('external_status'), // e.g., 'In Progress', 'Done'
    externalTitle: text('external_title'),
    direction: text('direction').notNull().default('outbound'), // 'outbound' (created from CLIaaS) | 'inbound' (linked existing) | 'bidirectional'
    metadata: jsonb('metadata').default({}), // provider-specific data (project key, labels, etc.)
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    ticketExternalLinksTicketIdx: index('ticket_external_links_ticket_idx').on(table.ticketId),
    ticketExternalLinksExternalIdx: uniqueIndex('ticket_external_links_external_idx').on(
      table.workspaceId, table.provider, table.externalId,
    ),
    ticketExternalLinksWorkspaceIdx: index('ticket_external_links_workspace_idx').on(table.workspaceId),
  }),
);
```

### 2C. New Table: `external_link_comments`

Synced comments between CLIaaS tickets and external issues.

```ts
export const externalLinkComments = pgTable(
  'external_link_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id').notNull().references(() => ticketExternalLinks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    direction: text('direction').notNull(), // 'to_external' | 'from_external'
    localMessageId: uuid('local_message_id'), // CLIaaS message ID (if originated locally)
    externalCommentId: text('external_comment_id'), // Jira/Linear comment ID
    body: text('body').notNull(),
    authorName: text('author_name'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    externalLinkCommentsLinkIdx: index('external_link_comments_link_idx').on(table.linkId),
  }),
);
```

### 2D. New Table: `crm_links`

Links CLIaaS customers/organizations to CRM records.

```ts
export const crmLinks = pgTable(
  'crm_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    provider: text('provider').notNull(), // 'salesforce' | 'hubspot-crm'
    // CLIaaS side
    entityType: text('entity_type').notNull(), // 'customer' | 'organization'
    entityId: uuid('entity_id').notNull(),
    // CRM side
    crmObjectType: text('crm_object_type').notNull(), // 'contact' | 'account' | 'opportunity' | 'deal' | 'company'
    crmObjectId: text('crm_object_id').notNull(),
    crmObjectUrl: text('crm_object_url'),
    // Cached CRM data (refreshed on sync)
    crmData: jsonb('crm_data').default({}), // { name, email, dealStage, dealAmount, owner, etc. }
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    crmLinksEntityIdx: index('crm_links_entity_idx').on(table.entityType, table.entityId),
    crmLinksExternalIdx: uniqueIndex('crm_links_external_idx').on(
      table.workspaceId, table.provider, table.crmObjectType, table.crmObjectId,
    ),
    crmLinksWorkspaceIdx: index('crm_links_workspace_idx').on(table.workspaceId),
  }),
);
```

### 2E. New Table: `integration_credentials`

Secure storage for non-helpdesk integration credentials (Jira, Linear, Salesforce, HubSpot CRM).

```ts
export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    provider: text('provider').notNull(), // 'jira' | 'linear' | 'salesforce' | 'hubspot-crm'
    authType: text('auth_type').notNull(), // 'api_token' | 'oauth2' | 'pat'
    credentials: jsonb('credentials').notNull(), // encrypted at rest: { token, refreshToken, baseUrl, email, etc. }
    scopes: text('scopes').array().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    integrationCredsWorkspaceProviderIdx: uniqueIndex('integration_creds_ws_provider_idx').on(
      table.workspaceId, table.provider,
    ),
  }),
);
```

### 2F. Custom Objects: 3 New Tables

#### `custom_object_types` — Schema definitions

```ts
export const customObjectTypes = pgTable(
  'custom_object_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    key: text('key').notNull(), // machine-readable slug, e.g., 'subscription', 'contract'
    name: text('name').notNull(), // human-readable, e.g., 'Subscription'
    namePlural: text('name_plural').notNull(), // e.g., 'Subscriptions'
    description: text('description'),
    icon: text('icon'), // optional emoji or icon key
    // Field definitions stored as JSONB array
    fields: jsonb('fields').notNull().default('[]'),
    // Each field: { key, name, type, required, options?, defaultValue? }
    // Types: text, number, boolean, date, select, multiselect, url, email, currency, relation
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectTypesKeyIdx: uniqueIndex('custom_object_types_key_idx').on(
      table.workspaceId, table.key,
    ),
  }),
);
```

#### `custom_object_records` — Instances

```ts
export const customObjectRecords = pgTable(
  'custom_object_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    typeId: uuid('type_id').notNull().references(() => customObjectTypes.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull().default({}), // field values keyed by field.key
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectRecordsTypeIdx: index('custom_object_records_type_idx').on(table.typeId),
    customObjectRecordsWorkspaceIdx: index('custom_object_records_workspace_idx').on(table.workspaceId),
  }),
);
```

#### `custom_object_relationships` — Links between objects and core entities

```ts
export const customObjectRelationships = pgTable(
  'custom_object_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    // Source side
    sourceType: text('source_type').notNull(), // 'custom_object' | 'ticket' | 'customer' | 'organization'
    sourceId: uuid('source_id').notNull(),
    // Target side
    targetType: text('target_type').notNull(), // 'custom_object' | 'ticket' | 'customer' | 'organization'
    targetId: uuid('target_id').notNull(),
    // Relationship metadata
    relationshipType: text('relationship_type').notNull().default('related'), // 'related' | 'parent' | 'child' | 'belongs_to'
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    customObjectRelsSourceIdx: index('custom_object_rels_source_idx').on(table.sourceType, table.sourceId),
    customObjectRelsTargetIdx: index('custom_object_rels_target_idx').on(table.targetType, table.targetId),
    customObjectRelsDedupIdx: uniqueIndex('custom_object_rels_dedup_idx').on(
      table.sourceType, table.sourceId, table.targetType, table.targetId,
    ),
  }),
);
```

### 2G. Column Additions to Existing Tables

None required. The link tables above handle all cross-references without modifying existing core tables.

### Summary: Schema Delta

| Change | Type | Count |
|--------|------|-------|
| New tables | `ticket_external_links`, `external_link_comments`, `crm_links`, `integration_credentials`, `custom_object_types`, `custom_object_records`, `custom_object_relationships` | 7 |
| New columns on existing tables | None | 0 |
| New enums | `integration_provider` (optional — can use text columns instead) | 0-1 |
| Total table count after | 73 + 7 = **80** | |

---

## 3. New API Routes

### 3A. Jira/Linear Integration (6 routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/integrations/engineering/configure` | POST | Save Jira/Linear credentials (API token, base URL, project key) |
| `/api/integrations/engineering/configure` | GET | Get current configuration status per provider |
| `/api/tickets/[id]/external-links` | GET | List all external links for a ticket |
| `/api/tickets/[id]/external-links` | POST | Create a new Jira/Linear issue from ticket OR link existing issue |
| `/api/tickets/[id]/external-links/[linkId]` | DELETE | Remove a link |
| `/api/tickets/[id]/external-links/[linkId]/sync` | POST | Trigger manual sync of a specific link |
| `/api/webhooks/jira` | POST | Jira webhook receiver for inbound status/comment updates |
| `/api/webhooks/linear` | POST | Linear webhook receiver for inbound status/comment updates |

### 3B. CRM Integration (6 routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/integrations/crm/configure` | POST | Save Salesforce/HubSpot CRM credentials |
| `/api/integrations/crm/configure` | GET | Get current CRM configuration status |
| `/api/integrations/crm/sync` | POST | Trigger CRM sync (pull contacts/accounts/deals) |
| `/api/customers/[id]/crm-links` | GET | Get all CRM records linked to a customer |
| `/api/customers/[id]/crm-links` | POST | Link a CRM record to a customer |
| `/api/customers/[id]/crm-links/[linkId]` | DELETE | Remove a CRM link |
| `/api/organizations/[id]/crm-links` | GET | Get CRM records linked to an organization |

### 3C. Custom Objects (8 routes)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/custom-objects/types` | GET | List all custom object type definitions |
| `/api/custom-objects/types` | POST | Create a new custom object type (schema) |
| `/api/custom-objects/types/[typeId]` | GET | Get a single type definition |
| `/api/custom-objects/types/[typeId]` | PATCH | Update a type definition (add/modify fields) |
| `/api/custom-objects/types/[typeId]` | DELETE | Delete a type and all its records |
| `/api/custom-objects/types/[typeId]/records` | GET | List records of a type (with filtering, pagination) |
| `/api/custom-objects/types/[typeId]/records` | POST | Create a record |
| `/api/custom-objects/types/[typeId]/records/[recordId]` | GET | Get a single record |
| `/api/custom-objects/types/[typeId]/records/[recordId]` | PATCH | Update a record |
| `/api/custom-objects/types/[typeId]/records/[recordId]` | DELETE | Delete a record |
| `/api/custom-objects/relationships` | GET | List relationships (filter by sourceType/sourceId or targetType/targetId) |
| `/api/custom-objects/relationships` | POST | Create a relationship |
| `/api/custom-objects/relationships/[id]` | DELETE | Remove a relationship |

**Total new API routes: ~23**

---

## 4. New/Modified UI Pages & Components

### 4A. New Pages

| Page | Route | Purpose |
|------|-------|---------|
| Custom Objects Management | `/custom-objects` | List object types, create new types, schema builder |
| Custom Object Records | `/custom-objects/[typeKey]` | List records for a type, CRUD |
| Custom Object Record Detail | `/custom-objects/[typeKey]/[recordId]` | View/edit a single record, see relationships |

### 4B. Modified Pages

| Page | File | Changes |
|------|------|---------|
| **Ticket Detail** | `src/app/tickets/[id]/page.tsx` | Add "Engineering Links" section showing linked Jira/Linear issues. Add "Create Jira Issue" / "Link Linear Issue" buttons. Add sidebar panel for related custom objects. |
| **Customer Detail** | `src/app/customers/[id]/page.tsx` | Add "CRM Data" sidebar section showing linked Salesforce/HubSpot records (deals, opportunities, account info). Add related custom objects section. |
| **Integrations Hub** | `src/app/integrations/page.tsx` | Add new tab "Engineering & CRM" with configuration cards for Jira, Linear, Salesforce, HubSpot CRM. Each card shows connection status, test button, credential inputs. |

### 4C. New Components

| Component | File | Purpose |
|-----------|------|---------|
| `ExternalLinkCard` | `src/components/ExternalLinkCard.tsx` | Displays a linked Jira/Linear issue with status badge, title, and sync indicator |
| `CreateExternalIssueModal` | `src/components/CreateExternalIssueModal.tsx` | Modal form: select provider (Jira/Linear), project, issue type, pre-fill summary from ticket subject |
| `LinkExternalIssueModal` | `src/components/LinkExternalIssueModal.tsx` | Modal with search: find existing Jira/Linear issue by key/title and link it |
| `CrmSidebar` | `src/components/CrmSidebar.tsx` | Shows CRM data for a customer: deal stage, revenue, account owner, recent activities |
| `CustomObjectSchemaBuilder` | `src/components/CustomObjectSchemaBuilder.tsx` | Field editor for defining custom object types: add/remove/reorder fields, set types, required, options |
| `CustomObjectRecordForm` | `src/components/CustomObjectRecordForm.tsx` | Dynamic form that renders based on a custom object type's field definitions |
| `RelatedObjectsPanel` | `src/components/RelatedObjectsPanel.tsx` | Reusable panel showing custom objects related to a ticket/customer/org, with "Link" button |
| `IntegrationConfigCard` | `src/components/IntegrationConfigCard.tsx` | Reusable card for configuring an integration (credentials input, test, status indicator) |

---

## 5. New CLI Commands

### 5A. Engineering Integration Commands

```
cliaas jira configure     # Set Jira credentials (base URL, email, API token)
cliaas jira link          # Link a ticket to a Jira issue: --ticket <id> --issue <PROJ-123>
cliaas jira create        # Create Jira issue from ticket: --ticket <id> --project <KEY> --type bug
cliaas jira sync          # Trigger sync of all linked Jira issues
cliaas jira status        # Show linked issues and their sync status

cliaas linear configure   # Set Linear API key
cliaas linear link        # Link a ticket to a Linear issue: --ticket <id> --issue <ID>
cliaas linear create      # Create Linear issue from ticket: --ticket <id> --team <slug>
cliaas linear sync        # Trigger sync of all linked Linear issues
cliaas linear status      # Show linked issues and their sync status
```

### 5B. CRM Commands

```
cliaas crm configure      # Set CRM credentials: --provider salesforce|hubspot
cliaas crm sync           # Pull CRM data (contacts, accounts, deals)
cliaas crm link           # Link customer to CRM record: --customer <id> --provider salesforce --record <id>
cliaas crm show           # Show CRM data for a customer: --customer <id>
cliaas crm status         # Show CRM sync status and linked record counts
```

### 5C. Custom Object Commands

```
cliaas objects types       # List custom object types
cliaas objects create-type # Create a type: --key subscription --name Subscription --fields '...'
cliaas objects records     # List records: --type subscription [--filter key=value]
cliaas objects create      # Create record: --type subscription --data '{"plan":"pro",...}'
cliaas objects show        # Show record: --type subscription --id <uuid>
cliaas objects update      # Update record: --type subscription --id <uuid> --data '{...}'
cliaas objects delete      # Delete record: --type subscription --id <uuid>
cliaas objects link        # Create relationship: --source ticket:<id> --target subscription:<id>
```

**Total new CLI command groups: 3 (jira, linear, crm) + extension of a new `objects` group**

---

## 6. New MCP Tools

### 6A. Engineering Integration Tools (New file: `cli/mcp/tools/engineering.ts`)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `jira_create_issue` | Create a Jira issue from a ticket context | `ticketId`, `project`, `issueType`, `summary?`, `description?`, `confirm` |
| `jira_link_issue` | Link an existing Jira issue to a ticket | `ticketId`, `issueKey`, `confirm` |
| `jira_sync` | Trigger sync of all linked Jira issues | `ticketId?` (optional, scope to one ticket) |
| `linear_create_issue` | Create a Linear issue from a ticket context | `ticketId`, `teamId`, `title?`, `description?`, `confirm` |
| `linear_link_issue` | Link an existing Linear issue to a ticket | `ticketId`, `issueId`, `confirm` |
| `linear_sync` | Trigger sync of all linked Linear issues | `ticketId?` |
| `ticket_external_links` | List all external links for a ticket | `ticketId` |

### 6B. CRM Tools (New file: `cli/mcp/tools/crm.ts`)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `crm_customer_data` | Show CRM data linked to a customer | `customerId` |
| `crm_link_record` | Link a CRM record to a customer | `customerId`, `provider`, `crmObjectType`, `crmObjectId`, `confirm` |
| `crm_sync` | Trigger CRM sync (pull contacts/deals) | `provider?` |
| `crm_search` | Search CRM records | `provider`, `objectType`, `query` |

### 6C. Custom Object Tools (New file: `cli/mcp/tools/custom-objects.ts`)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `custom_object_types` | List all custom object type definitions | — |
| `custom_object_create_type` | Define a new custom object type | `key`, `name`, `fields[]`, `confirm` |
| `custom_object_create` | Create a custom object record | `typeKey`, `data{}`, `confirm` |
| `custom_object_search` | Search custom object records | `typeKey`, `filter?`, `limit?` |
| `custom_object_show` | Get a specific record | `typeKey`, `recordId` |
| `custom_object_update` | Update a record | `typeKey`, `recordId`, `data{}`, `confirm` |
| `custom_object_link` | Create a relationship between objects | `sourceType`, `sourceId`, `targetType`, `targetId`, `confirm` |
| `custom_object_relationships` | List relationships for an entity | `entityType`, `entityId` |

**Total new MCP tools: 19** (7 engineering + 4 CRM + 8 custom objects)
**New MCP tool count: 60 + 19 = 79**

### Registration in `cli/mcp/server.ts`

Add 3 new imports and registrations:
```ts
import { registerEngineeringTools } from './tools/engineering.js';
import { registerCrmTools } from './tools/crm.js';
import { registerCustomObjectTools } from './tools/custom-objects.js';

registerEngineeringTools(server);
registerCrmTools(server);
registerCustomObjectTools(server);
```

---

## 7. New Library Modules

### 7A. Integration Clients

| Module | File | Purpose |
|--------|------|---------|
| Jira client | `src/lib/integrations/jira-client.ts` | REST API client for Jira Cloud (v3 API): create issue, get issue, update issue, add comment, search, transitions, webhooks |
| Linear client | `src/lib/integrations/linear-client.ts` | GraphQL client for Linear API: create issue, get issue, update state, add comment, search, webhooks |
| Salesforce client | `src/lib/integrations/salesforce-client.ts` | REST API client for Salesforce (SOQL queries, CRUD on Contact, Account, Opportunity) |
| HubSpot CRM client | `src/lib/integrations/hubspot-crm-client.ts` | Extends existing HubSpot connector for CRM-specific operations (contacts, companies, deals with associations) |

### 7B. Sync Engines

| Module | File | Purpose |
|--------|------|---------|
| Engineering sync | `src/lib/integrations/engineering-sync.ts` | Bidirectional sync for Jira/Linear: status mapping, comment sync, polling + webhook processing |
| CRM sync | `src/lib/integrations/crm-sync.ts` | Pull contacts/accounts/deals from CRM, match to CLIaaS customers by email, push customer updates back |
| Custom objects store | `src/lib/custom-objects.ts` | JSONL-mode fallback store for custom object types, records, and relationships (mirrors JSONL pattern from `custom-fields.ts`) |

### 7C. Status Mapping

| Module | File | Purpose |
|--------|------|---------|
| Status mapper | `src/lib/integrations/status-mapper.ts` | Bidirectional status mapping: Jira workflow states <-> CLIaaS ticket statuses, Linear states <-> CLIaaS statuses. Configurable per workspace. |

---

## 8. Migration / Rollout Plan

### Phase 1: Foundation (Week 1-2) — Size: L

1. **DB migration `0005_integrations_expansion.sql`**:
   - Create all 7 new tables
   - No destructive changes to existing tables
   - RLS policies for new tables (workspace_id scoping)

2. **Integration credential storage**:
   - `integration_credentials` table + encrypt-at-rest for credentials JSONB
   - API routes for configure/verify per provider
   - UI: IntegrationConfigCard component, new "Engineering & CRM" tab in Integrations Hub

3. **JSONL fallback stores**:
   - `src/lib/custom-objects.ts` — in-memory + JSONL for custom objects (demo mode)
   - `src/lib/integrations/link-store.ts` — in-memory store for ticket external links (demo mode)

### Phase 2: Jira/Linear Integration (Week 2-3) — Size: L

4. **Jira client + sync**:
   - `jira-client.ts`: authenticate (email + API token for Cloud, PAT for Server), create/get/update/search issues, manage comments, handle transitions
   - `engineering-sync.ts`: status mapping engine (configurable), comment sync (dedup by external_comment_id), polling-based sync
   - Webhook receiver: `/api/webhooks/jira` — process issue_updated, comment_created events
   - Status mapper: Jira "To Do" -> CLIaaS "open", "In Progress" -> "pending", "Done" -> "solved"

5. **Linear client + sync**:
   - `linear-client.ts`: GraphQL client (API key auth), create/get/update issues, manage comments
   - Reuse engineering-sync.ts with Linear-specific adapters
   - Webhook receiver: `/api/webhooks/linear` — process Issue, Comment events
   - Status mapper: Linear "Backlog"/"Todo" -> "open", "In Progress" -> "pending", "Done" -> "solved"

6. **Ticket detail UI**:
   - "Engineering Links" section in ticket detail page
   - "Create Jira Issue" / "Create Linear Issue" buttons
   - "Link Existing Issue" modal with search
   - ExternalLinkCard showing status, title, sync indicator

7. **CLI + MCP tools**:
   - `cliaas jira` and `cliaas linear` command groups
   - 7 MCP tools in `engineering.ts`

### Phase 3: CRM Integration (Week 3-4) — Size: L

8. **Salesforce client**:
   - OAuth 2.0 flow (or connected app with username/password/security token for demo)
   - SOQL queries for Contact, Account, Opportunity
   - CRUD operations for bidirectional sync

9. **HubSpot CRM client** (extends existing connector):
   - Contact/Company/Deal CRUD (already partially in `hubspot.ts` lines 226-298)
   - Association queries (contact -> deals, contact -> companies)
   - Bidirectional: push customer updates from CLIaaS to HubSpot

10. **CRM sync engine**:
    - Match CRM contacts to CLIaaS customers by email
    - Auto-link matched records in `crm_links`
    - Cache CRM data in `crm_links.crm_data` JSONB
    - Periodic refresh (configurable interval)

11. **Customer sidebar**:
    - CrmSidebar component showing linked deals, opportunities, account info
    - Integrated into customer detail page
    - Also available as a panel in ticket detail (via requester -> customer -> CRM links)

12. **CLI + MCP tools**:
    - `cliaas crm` command group
    - 4 MCP tools in `crm.ts`

### Phase 4: Custom Objects (Week 4-5) — Size: L

13. **Schema builder**:
    - CustomObjectSchemaBuilder component (field editor: name, type, required, options)
    - Supported field types: text, number, boolean, date, select, multiselect, url, email, currency, relation
    - Validation: unique keys, required fields, type constraints

14. **Record CRUD**:
    - CustomObjectRecordForm (dynamic form rendering from type definition)
    - List view with filtering/sorting
    - Record detail view with edit

15. **Relationships**:
    - RelatedObjectsPanel (reusable in ticket detail, customer detail, record detail)
    - Link picker: search for records to relate
    - Visual relationship display

16. **API + CLI + MCP**:
    - 13 API routes for custom object types/records/relationships
    - `cliaas objects` command group
    - 8 MCP tools in `custom-objects.ts`

### Phase 5: Polish & Testing (Week 5-6) — Size: M

17. **Integration tests**:
    - Mock-based tests for Jira/Linear API clients
    - Status mapping tests (all state combinations)
    - Custom object schema validation tests
    - Relationship constraint tests
    - Webhook signature verification tests (Jira, Linear)

18. **Feature gating**:
    - Engineering integrations: available on pro+ and byoc
    - CRM integrations: available on pro+ and byoc
    - Custom objects: available on starter+ and byoc (basic), pro+ for relationships

19. **Documentation**:
    - Update ARCHITECTURE.md with new table counts, tool counts, API route counts
    - Integration setup guides for Jira, Linear, Salesforce, HubSpot CRM

---

## 9. Effort Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 1: Foundation | 7 tables, credentials, config UI | **L** (3-4 days) |
| Phase 2: Jira/Linear | 2 API clients, sync engine, webhooks, UI, CLI, MCP | **L** (5-6 days) |
| Phase 3: CRM | 2 API clients, sync engine, sidebar UI, CLI, MCP | **L** (4-5 days) |
| Phase 4: Custom Objects | Schema builder, record CRUD, relationships, API, CLI, MCP | **L** (5-6 days) |
| Phase 5: Polish | Tests, gating, docs | **M** (2-3 days) |

**Overall: XL (19-24 engineering days / ~4-5 calendar weeks)**

### Justification for XL

- 7 new DB tables with migration + RLS
- 4 new external API clients (Jira, Linear, Salesforce, HubSpot CRM) each with auth, rate limiting, error handling
- 2 bidirectional sync engines (engineering + CRM) with status mapping and conflict handling
- 2 webhook receivers with signature verification
- ~23 new API routes
- 3 new UI pages + 3 modified pages + 8 new components
- 3 new CLI command groups (~20 subcommands)
- 19 new MCP tools across 3 modules
- Integration tests for all external API interactions

### Risk Factors

1. **Jira Server vs Cloud** — Jira Cloud uses REST v3 with OAuth; Jira Server/Data Center uses different auth. Initial scope should target Cloud only.
2. **Salesforce OAuth complexity** — Salesforce Connected App setup is notoriously complex. Consider supporting username+password+security token flow for BYOC simplicity.
3. **Rate limits** — Jira (429 with retry-after), Linear (1,500/hour), Salesforce (15,000/day). Need robust rate-limit handling in all clients.
4. **Custom object field migrations** — When a type's field definitions change, existing records may have stale data. Need a migration/backfill strategy.
5. **Status mapping is workspace-specific** — Different teams use different Jira workflows. The status mapper must be configurable, not hardcoded.

### Dependencies

- None hard. This plan builds on existing infrastructure (connector pattern, upstream outbox, MCP tool registration).
- Soft dependency: Plan 04 (Marketplace) — Jira/Linear/Salesforce could eventually be implemented as first-party plugins if the marketplace platform exists.

---

## 10. Competitive Position After Implementation

| Capability | Zendesk | Freshdesk | Intercom | Pylon | CLIaaS (After) |
|------------|---------|-----------|----------|-------|----------------|
| Jira integration | Native | Native | Marketplace | Native | Native + MCP |
| Linear integration | Marketplace | No | Marketplace | Native | Native + MCP |
| Salesforce sync | Native (deep) | Native | Native | Native | Native + MCP |
| HubSpot CRM sync | Marketplace | Native | Native | Native | Native + MCP |
| Custom objects | Sunshine platform | API-only | No | No | Schema builder + API + MCP |
| AI agent access to integrations | No | No | No | No | **19 MCP tools** (unique differentiator) |

The MCP-native approach is the key differentiator: AI agents can create Jira issues, search CRM data, and query custom objects through the same tool interface they use for tickets. No competitor offers this level of AI-accessible integration data.
