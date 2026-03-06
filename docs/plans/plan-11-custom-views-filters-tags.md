# Plan 11: Custom Views, Saved Filters & Tags

## 1. Summary of What Exists Today

### DB Schema (src/db/schema.ts)

**`views` table** (line 476-483):
```typescript
export const views = pgTable('views', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  query: jsonb('query').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```
- Table exists but has **no UI, no API routes, no CLI commands, no MCP tools**
- Missing: `userId` (personal vs shared), `position` (ordering), `updatedAt`, `isDefault`, `description`, `viewType` (personal/shared/system)

**`tags` table** (line 378-392):
```typescript
export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  tagsWorkspaceNameIdx: uniqueIndex('tags_workspace_name_idx').on(table.workspaceId, table.name),
}));
```
- Table exists with unique constraint on (workspace, name) -- good
- Missing: `color` column for visual tag chips in UI

**`ticket_tags` table** (line 394-405):
```typescript
export const ticketTags = pgTable('ticket_tags', {
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
  tagId: uuid('tag_id').notNull().references(() => tags.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
}, table => ({
  pk: primaryKey({ columns: [table.ticketId, table.tagId] }),
  ticketTagsWorkspaceIdx: index('ticket_tags_workspace_idx').on(table.workspaceId),
}));
```
- Join table exists with composite PK -- good

**`tickets` table** (line 286-308):
- Has `tags: text('tags').array().default([])` -- a denormalized text array on the tickets table itself
- This means tags exist in TWO places: as a text array on tickets AND as normalized rows in tags/ticket_tags
- The JSONL/file-based provider uses the array; the DB provider reads from the join table (db-provider.ts line 143-156)

### Ticket Detail UI (src/app/tickets/[id]/page.tsx)

- **Tags display exists** (line 102-119): Shows tags as read-only chips in ticket header metadata section
- **No tag editing UI**: Cannot add/remove tags from the ticket detail page
- **No tag autocomplete**: No search/suggestion component for tags
- **TicketActions component** (src/components/TicketActions.tsx): Only supports status and priority updates -- no tag editing

### Ticket List UI (src/app/tickets/page.tsx)

- **Filter chips exist** (line 90-132): Hardcoded filter chips for status, source, priority
- **Tag search**: `q` search param matches tags (line 47), but there's no dedicated tag filter chip
- **No sidebar**: Ticket list is a standalone page with no persistent sidebar for saved views
- **No view selector**: Cannot switch between saved views

### Dashboard (src/app/dashboard/page.tsx)

- Shows recent tickets and stat cards (open, urgent, pending counts)
- **No views integration**: No sidebar, no saved view navigation

### AppNav (src/components/AppNav.tsx)

- Horizontal top nav bar with links to system modules
- **No sidebar**: No left sidebar for views -- the nav is purely top-bar
- **No "Tickets" link** in nav (tickets is accessed from dashboard)

### API Routes (src/app/api/tickets/)

- `GET /api/tickets` (route.ts): Supports `status`, `priority`, `assignee`, `q` filters, `sort`, `limit`, `offset` pagination
- `PATCH /api/tickets/[id]` (route.ts): Updates status, priority, subject -- **does not handle tags**
- **No `/api/views/` routes** exist
- **No `/api/tags/` routes** exist

### CLI (cli/commands/tickets.ts)

- `cliaas tickets list`: Supports `--status`, `--priority`, `--assignee`, `--tag`, `--source`, `--sort` filters
- `cliaas tickets search`: Full-text search across tickets and messages
- `cliaas tickets show`: Shows ticket details including tags
- **No view commands** (no `cliaas views list/create/delete`)
- **No tag management commands** (no `cliaas tags list/create/delete`)

### MCP Tools

- `tickets_list` (cli/mcp/tools/tickets.ts): Supports status, priority, assignee, tag filters
- `ticket_update` (cli/mcp/tools/actions.ts line 17-87): Supports `addTags` and `removeTags` parameters -- **but only modifies in-memory JSONL data, does not use DB tags/ticket_tags tables**
- **No `view_list`, `view_create`, `tag_add`, `tag_remove` MCP tools** exist

### Data Provider (src/lib/data-provider/)

- `TicketUpdateParams` (types.ts line 153-160): Already defines `addTags?: string[]` and `removeTags?: string[]`
- `DbProvider.updateTicket()` (db-provider.ts line 489-498): **Ignores addTags/removeTags** -- only updates status, priority, subject
- `DbProvider.loadTickets()` (db-provider.ts line 143-170): Correctly reads tags from the join table
- `JsonlProvider`: Tags come from the inline `tags[]` array in JSONL ticket records

### Gap Summary

1. **Views**: Schema exists, everything else missing (API, UI, CLI, MCP)
2. **Tags**: Schema exists, join table exists, DB read works, but DB writes (add/remove tags) are not implemented, no CRUD API, no management UI, no tag picker in ticket detail
3. **Tag editing via MCP**: `ticket_update` handles addTags/removeTags but only in-memory (JSONL mode). DB mode ignores them.
4. **No sidebar**: The entire concept of a sidebar with views is absent from the UI
5. **No view execution engine**: No code to take a view's JSONB `query` and translate it into ticket filters

---

## 2. Proposed DB Schema Changes

### Modified Table: `views`

Add columns for personal/shared distinction, ordering, and richer metadata.

```sql
-- Migration: 0006_views_and_tags.sql

-- Add columns to views table
ALTER TABLE views ADD COLUMN user_id UUID REFERENCES users(id);
  -- NULL = shared/system view, non-NULL = personal view owned by this user
ALTER TABLE views ADD COLUMN view_type TEXT NOT NULL DEFAULT 'shared'
  CHECK (view_type IN ('system', 'shared', 'personal'));
ALTER TABLE views ADD COLUMN description TEXT;
ALTER TABLE views ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE views ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index for listing views per user (personal + shared)
CREATE INDEX views_workspace_user_idx ON views(workspace_id, user_id);
CREATE INDEX views_workspace_type_idx ON views(workspace_id, view_type);
```

### Modified Table: `tags`

Add a color column for visual display.

```sql
ALTER TABLE tags ADD COLUMN color TEXT DEFAULT '#71717a';
  -- Hex color for tag chip display. Default: zinc-500
ALTER TABLE tags ADD COLUMN description TEXT;
```

### No New Tables Required

The existing `views`, `tags`, and `ticket_tags` tables provide the correct relational foundation. We only need to augment them.

### View Query Format (JSONB)

The `query` JSONB column stores the view filter definition. Proposed schema:

```typescript
interface ViewQuery {
  conditions: ViewCondition[];
  operator: 'and' | 'or';       // how to combine conditions
  sort?: {
    field: 'created' | 'updated' | 'priority' | 'status';
    direction: 'asc' | 'desc';
  };
}

interface ViewCondition {
  field: 'status' | 'priority' | 'assignee' | 'tag' | 'requester'
       | 'source' | 'group' | 'created_at' | 'updated_at' | 'custom_field';
  operator: 'is' | 'is_not' | 'contains' | 'not_contains'
          | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty';
  value: string | string[] | number | null;
  customFieldId?: string;  // only when field === 'custom_field'
}
```

### Default System Views (seeded on workspace creation)

| Name | Type | Query |
|------|------|-------|
| My Open Tickets | system | `{conditions: [{field:"assignee", operator:"is", value:"$CURRENT_USER"}, {field:"status", operator:"is", value:["open","pending"]}], operator:"and"}` |
| Unassigned | system | `{conditions: [{field:"assignee", operator:"is_empty", value:null}, {field:"status", operator:"is", value:["open","pending"]}], operator:"and"}` |
| All Open | system | `{conditions: [{field:"status", operator:"is", value:["open","pending","on_hold"]}], operator:"and"}` |
| Recently Updated | system | `{conditions: [{field:"status", operator:"is_not", value:["closed"]}], operator:"and", sort:{field:"updated", direction:"desc"}}` |

---

## 3. New API Routes Needed

### Views API: `/api/views/`

| Method | Route | Purpose | Auth Scope |
|--------|-------|---------|------------|
| `GET` | `/api/views` | List views (system + shared + current user's personal) | `views:read` |
| `POST` | `/api/views` | Create a new view | `views:write` |
| `GET` | `/api/views/[id]` | Get a single view definition | `views:read` |
| `PATCH` | `/api/views/[id]` | Update view (name, query, position, active) | `views:write` |
| `DELETE` | `/api/views/[id]` | Delete a view (not system views) | `views:write` |
| `GET` | `/api/views/[id]/count` | Get ticket count matching this view's query | `views:read` |
| `GET` | `/api/views/[id]/tickets` | Execute view query, return matching tickets (with pagination) | `tickets:read` |
| `PATCH` | `/api/views/reorder` | Bulk update view positions `[{id, position}]` | `views:write` |

### Tags API: `/api/tags/`

| Method | Route | Purpose | Auth Scope |
|--------|-------|---------|------------|
| `GET` | `/api/tags` | List all tags in workspace (with usage counts) | `tags:read` |
| `POST` | `/api/tags` | Create a new tag | `tags:write` |
| `PATCH` | `/api/tags/[id]` | Update tag (name, color, description) | `tags:write` |
| `DELETE` | `/api/tags/[id]` | Delete tag (removes all ticket associations) | `tags:write` |
| `GET` | `/api/tags/autocomplete?q=` | Search tags by prefix (for autocomplete) | `tags:read` |

### Ticket Tag Operations: `/api/tickets/[id]/tags`

| Method | Route | Purpose | Auth Scope |
|--------|-------|---------|------------|
| `GET` | `/api/tickets/[id]/tags` | List tags on a specific ticket | `tickets:read` |
| `POST` | `/api/tickets/[id]/tags` | Add tags to a ticket `{tags: ["billing","urgent"]}` | `tickets:write` |
| `DELETE` | `/api/tickets/[id]/tags` | Remove tags from a ticket `{tags: ["billing"]}` | `tickets:write` |

### Bulk Tag Operations: `/api/tickets/bulk/tags`

| Method | Route | Purpose | Auth Scope |
|--------|-------|---------|------------|
| `POST` | `/api/tickets/bulk/tags` | Add/remove tags on multiple tickets `{ticketIds, addTags, removeTags}` | `tickets:write` |

**Total: 14 new API routes** (8 views + 4 tags + 1 ticket-tags + 1 bulk)

---

## 4. New/Modified UI Pages & Components

### New Components

#### `src/components/ViewsSidebar.tsx` (new)
- Left sidebar panel listing saved views grouped by type (System, Shared, Personal)
- Each view item shows: name, ticket count badge
- Active view highlighted
- Drag-and-drop reorder (via HTML5 drag API or a lightweight library)
- "+ New View" button at bottom
- Collapsible sections per view type
- Client component (needs interactivity for drag-drop and click)

#### `src/components/TagPicker.tsx` (new)
- Autocomplete input for adding tags to a ticket
- Shows existing tags on ticket as removable chips
- Dropdown fetches from `/api/tags/autocomplete?q=` on keystroke
- Supports creating new tags inline (type + Enter if no match)
- Used in ticket detail page and bulk actions modal
- Client component

#### `src/components/ViewBuilder.tsx` (new)
- Form for creating/editing a view
- Add condition rows: field selector, operator selector, value input
- AND/OR toggle for condition combining
- Sort configuration (field + direction)
- Name, description, view type (personal/shared) fields
- Preview: shows live ticket count as conditions change
- Client component

#### `src/components/BulkActions.tsx` (new)
- Floating action bar that appears when tickets are selected (checkboxes in ticket list)
- Actions: Add Tags, Remove Tags, Change Status, Change Priority, Assign
- Opens a modal for tag operations with TagPicker embedded
- Client component

### Modified Components

#### `src/components/TicketActions.tsx` (modified)
- Add a TagPicker section below the status/priority update controls
- Shows current tags as removable chips
- Autocomplete input to add new tags
- Calls `POST/DELETE /api/tickets/[id]/tags`

#### `src/components/AppNav.tsx` (modified)
- Add "Tickets" link to the nav bar (currently absent)
- Consider adding a "Views" dropdown or ensuring the tickets page has sidebar integration

### New Pages

#### `src/app/tickets/layout.tsx` (new)
- Wraps the ticket list and detail pages in a layout with ViewsSidebar on the left
- Two-column layout: sidebar (280px) + main content area
- Sidebar loads views from `/api/views` and passes as context

#### `src/app/views/new/page.tsx` (new)
- Full-page view builder using ViewBuilder component
- POST to `/api/views` on save
- Redirect to `/tickets?view=<id>` after creation

#### `src/app/views/[id]/edit/page.tsx` (new)
- Edit an existing view using ViewBuilder component
- Pre-populates with current view data
- PATCH to `/api/views/[id]` on save

#### `src/app/settings/tags/page.tsx` (new)
- Tag management page: list all tags with usage counts
- Inline edit tag name/color
- Delete tag with confirmation
- Create new tag form
- Linked from Settings page

### Modified Pages

#### `src/app/tickets/page.tsx` (modified)
- Accept `?view=<id>` search param
- If `view` param present, fetch view definition from `/api/views/[id]` and apply its query as filters
- Replace hardcoded filter chips with dynamic chips based on active view's conditions
- Add checkbox column for bulk selection
- Integrate with BulkActions bar

#### `src/app/tickets/[id]/page.tsx` (modified)
- Replace read-only tag display (line 102-119) with interactive TagPicker component
- Pass current ticket tags and ticketId to TagPicker

#### `src/app/dashboard/page.tsx` (modified)
- Optionally show top 5 views with ticket counts in a "Quick Views" card
- Link each to `/tickets?view=<id>`

---

## 5. New CLI Commands

### `cliaas views` command group

```
cliaas views list                          # List all views (system + shared + personal)
cliaas views show <id>                     # Show view details and query definition
cliaas views create --name <n> --query <json>  # Create a new view
  --type personal|shared                   # View type (default: personal)
  --description <desc>                     # Optional description
cliaas views delete <id>                   # Delete a view
cliaas views execute <id>                  # Run the view query and show matching tickets
  --limit <n>                              # Max tickets (default: 25)
```

Implementation file: `cli/commands/views.ts`

Register in `cli/commands/index.ts` via `registerViewCommands(program)`.

### `cliaas tags` command group

```
cliaas tags list                           # List all tags with usage counts
cliaas tags create <name>                  # Create a new tag
  --color <hex>                            # Optional color
cliaas tags delete <name|id>               # Delete a tag
cliaas tags add --ticket <id> --tags <t1,t2>    # Add tags to a ticket
cliaas tags remove --ticket <id> --tags <t1,t2> # Remove tags from a ticket
```

Implementation file: `cli/commands/tags.ts`

Register in `cli/commands/index.ts` via `registerTagCommands(program)`.

---

## 6. New MCP Tools

### Views Tools (new file: `cli/mcp/tools/views.ts`)

| Tool | Description | Parameters |
|------|-------------|------------|
| `view_list` | List all views in the workspace | `viewType?: 'system'\|'shared'\|'personal'` |
| `view_create` | Create a saved view | `name: string, conditions: ViewCondition[], operator?: 'and'\|'or', viewType?: 'personal'\|'shared', confirm: boolean` |
| `view_get` | Get a view definition | `viewId: string` |
| `view_execute` | Run a view's query and return matching tickets | `viewId: string, limit?: number` |
| `view_delete` | Delete a saved view | `viewId: string, confirm: boolean` |

### Tags Tools (new file: `cli/mcp/tools/tags.ts`)

| Tool | Description | Parameters |
|------|-------------|------------|
| `tag_list` | List all tags in the workspace with usage counts | (none) |
| `tag_create` | Create a new tag | `name: string, color?: string, confirm: boolean` |
| `tag_add` | Add tags to a ticket | `ticketId: string, tags: string[], confirm: boolean` |
| `tag_remove` | Remove tags from a ticket | `ticketId: string, tags: string[], confirm: boolean` |
| `tag_delete` | Delete a tag from the workspace | `tagId: string, confirm: boolean` |

### Registration

Register in `cli/mcp/server.ts`:
```typescript
import { registerViewTools } from './tools/views.js';
import { registerTagTools } from './tools/tags.js';
// ...
registerViewTools(server);
registerTagTools(server);
```

**Total: 10 new MCP tools** (5 views + 5 tags), bringing total from 60 to 70.

### Existing Tool Modifications

**`ticket_update`** (cli/mcp/tools/actions.ts): No changes needed for JSONL mode (already handles addTags/removeTags in-memory). For DB mode, the `DbProvider.updateTicket()` method must be fixed to handle `addTags`/`removeTags` (see implementation plan below).

---

## 7. Migration & Rollout Plan

### Phase 1: Schema & Data Layer (Days 1-2)

1. **Write migration** `src/db/migrations/0006_views_and_tags.sql`:
   - ALTER `views` table: add `user_id`, `view_type`, `description`, `position`, `updated_at`
   - ALTER `tags` table: add `color`, `description`
   - Create indexes
2. **Fix `DbProvider.updateTicket()`** (db-provider.ts line 489-498):
   - Implement `addTags` handling: upsert into `tags` table (get-or-create by name), then insert into `ticket_tags`
   - Implement `removeTags` handling: delete from `ticket_tags` where tag name matches
   - Also update the inline `tickets.tags` text array to keep it in sync
3. **Add view query execution logic**: New file `src/lib/views/executor.ts`
   - `executeViewQuery(query: ViewQuery, workspaceId: string): Promise<Ticket[]>`
   - Translates ViewQuery conditions into Drizzle `where` clauses
   - Handles `$CURRENT_USER` variable substitution
   - Falls back to in-memory filtering for JSONL mode
4. **Add DataProvider methods** for views and tags:
   - Add to `DataProvider` interface: `loadViews()`, `createView()`, `updateView()`, `deleteView()`, `loadTags()`, `createTag()`, `deleteTag()`, `addTicketTags()`, `removeTicketTags()`
   - Implement in `DbProvider`
   - Implement stubs/in-memory versions in `JsonlProvider`
5. **Seed default system views** in workspace creation flow

### Phase 2: API Routes (Days 3-4)

6. **Create all 14 API routes** (views CRUD, tags CRUD, ticket-tags, bulk-tags)
7. **Add auth scopes**: `views:read`, `views:write`, `tags:read`, `tags:write` to scope system
8. **Write API tests**: At least smoke tests for each endpoint (CRUD + error cases)

### Phase 3: CLI & MCP Tools (Days 4-5)

9. **Create `cli/commands/views.ts`** and **`cli/commands/tags.ts`**
10. **Register in `cli/commands/index.ts`**
11. **Create `cli/mcp/tools/views.ts`** and **`cli/mcp/tools/tags.ts`**
12. **Register in `cli/mcp/server.ts`**
13. **Write MCP tool tests** (following pattern in `cli/mcp/tools/__tests__/`)

### Phase 4: UI Components (Days 5-8)

14. **Build `TagPicker` component**: Autocomplete + chip display + create-inline
15. **Build `ViewBuilder` component**: Condition rows + sort config + preview
16. **Build `ViewsSidebar` component**: Grouped view list + counts + drag-drop reorder
17. **Build `BulkActions` component**: Selection bar with tag operations

### Phase 5: UI Integration (Days 8-10)

18. **Create `src/app/tickets/layout.tsx`**: Two-column layout with ViewsSidebar
19. **Modify `src/app/tickets/page.tsx`**: Add `?view=` support, checkbox column, bulk actions
20. **Modify `src/app/tickets/[id]/page.tsx`**: Replace read-only tags with TagPicker
21. **Modify `src/components/TicketActions.tsx`**: Add tag editing section
22. **Create view builder pages**: `/views/new/page.tsx`, `/views/[id]/edit/page.tsx`
23. **Create tag management page**: `/settings/tags/page.tsx`

### Phase 6: Polish & Testing (Days 10-12)

24. **Default view seeding**: Ensure new workspaces get 4 default system views
25. **View count caching**: Implement efficient count queries (debounced, not per-render)
26. **Drag-and-drop ordering**: Test reorder persistence
27. **Tag color picker**: Simple preset palette or hex input
28. **Bulk operations**: Test multi-select + bulk tag add/remove
29. **Update ARCHITECTURE.md**: Document new tables, routes, components
30. **Update MCP tool count** in ARCHITECTURE.md (60 -> 70)

### Rollback Plan

- Migration is additive only (ALTER TABLE ADD COLUMN) -- safe to roll forward
- New API routes are independent -- can be deployed without UI
- UI changes are behind the `?view=` param until sidebar is wired in
- No breaking changes to existing API or CLI interfaces

---

## 8. Effort Estimate

**Size: L (Large)**

| Component | Estimate | Reasoning |
|-----------|----------|-----------|
| Schema migration + data layer | 2 days | Fix DbProvider.updateTicket for tags, add view executor, add DataProvider methods |
| API routes (14 endpoints) | 2 days | CRUD + view execution + bulk ops + auth scopes |
| CLI commands (2 groups) | 1 day | Following established patterns |
| MCP tools (10 tools) | 1 day | Following established patterns |
| UI components (4 new) | 3 days | TagPicker with autocomplete, ViewBuilder with dynamic conditions, ViewsSidebar with drag-drop, BulkActions |
| UI integration (layout + pages) | 2 days | Two-column layout, view execution in ticket list, tag editing in ticket detail |
| Testing + polish | 1 day | API tests, component tests, default view seeding |
| **Total** | **~12 days** | One developer, ~2.5 weeks |

### Risk Factors

1. **Dual tag storage**: Tickets have both `tags text[]` column AND `ticket_tags` join table. Must keep them in sync or deprecate one. Recommendation: treat `ticket_tags` as source of truth for DB mode; keep `tags[]` array for JSONL/demo mode only. Update `DbProvider` writes to maintain both.
2. **View query performance**: Complex view queries with tag joins, custom field conditions, and date ranges could be slow on large datasets. Mitigate with proper indexes and query-count caching.
3. **Sidebar layout change**: Adding a persistent left sidebar to the tickets section is a significant layout shift. Must ensure responsive behavior (sidebar collapses on mobile).
4. **JSONL mode limitations**: Views and tags in JSONL mode will be limited (in-memory, non-persistent across restarts). Acceptable for demo mode.

### Dependencies

- None -- all changes are net-new or additive modifications to existing code
- No external library dependencies required (drag-and-drop can use HTML5 native API)
- No infrastructure changes (no new services, databases, or queues)
