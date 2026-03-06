# Plan 15: Limited-Permission Agent Roles, Collaborator Access, Granular RBAC

**Status:** Draft (revised)
**Priority:** High (blocks enterprise readiness)
**Effort:** L (Large) -- estimated 12-16 days without stretch, 15-20 days with custom roles

---

## 1. Summary of What Exists Today

### 1.1 User Role System

- **DB enum** (`src/db/schema.ts:105-110`): `userRoleEnum` defines five values: `owner`, `admin`, `agent`, `viewer`, `system`. No `light_agent` or `collaborator` role.
- **Users table** (`src/db/schema.ts:157-178`): Each user has a single `role` column from the enum, scoped to one `workspaceId`. No cross-workspace membership.
- **Auth Role type** (`src/lib/api-auth.ts:15`): `type Role = 'owner' | 'admin' | 'agent'` -- narrower than the DB enum. `viewer` and `system` exist in the DB but are not recognized by the auth system.
- **Role hierarchy** (`src/lib/api-auth.ts:36-40`): Simple numeric hierarchy: `owner: 3, admin: 2, agent: 1`. No entry for `viewer` or `system` -- they default to `0`.
- **Session JWT** (`src/lib/auth.ts:21-28`): `SessionUser` includes `role: Role` -- no permissions array. JWT is signed with HS256, 7-day expiry.

### 1.2 Auth Middleware & Route Guards

- **Edge middleware** (`src/middleware.ts:88-289`): Verifies JWT cookies, sets internal headers (`x-user-id`, `x-user-role`, `x-workspace-id`, `x-user-email`, `x-tenant-id`). No role-based route blocking at the middleware level -- all authenticated users reach all non-public routes. In demo mode (no `DATABASE_URL`), auth is skipped entirely.
- **Route-level guards** (`src/lib/api-auth.ts:92-231`): Four guard functions:
  - `requireAuth(request)` -- returns user or 401
  - `requireRole(request, minimumRole)` -- checks numeric hierarchy, returns 403 if insufficient
  - `requireScope(request, scope)` -- for API key scope validation; session users always pass (implicit `*`)
  - `requireScopeAndRole(request, scope, minimumRole)` -- combined check
- **Coverage**: Of ~186 API route files, 137 call at least one auth guard. Most use `requireAuth` (any authenticated user). Only a handful use `requireRole('admin')` (e.g., `src/app/api/users/[id]/route.ts:11`, `src/app/api/users/invite/route.ts:8`). There are NO per-action permission checks anywhere.
- **Auth coverage gap** (noted in `ARCHITECTURE.md:669`): ~88% of API routes lack granular authorization -- they verify identity but not permissions.

### 1.3 API Key Scopes

- **API keys table** (`src/db/schema.ts:856-876`): Keys have a `scopes` text array.
- **Valid scopes** (`src/lib/api-auth.ts:134-144`): `tickets:read`, `tickets:write`, `kb:read`, `kb:write`, `analytics:read`, `webhooks:read`, `webhooks:write`, `admin:*`, `*`.
- **Scope enforcement** (`src/lib/api-auth.ts:150-161`): Only checked for API key auth. Session users get implicit wildcard.
- **Key validation** (`src/lib/api-keys.ts:132-177`): `validateApiKey()` returns `AuthUser` with `role` from the key creator's user record and `scopes` from the key record.

### 1.4 User Management

- **User service** (`src/lib/user-service.ts`):
  - `updateUser()` (line 36): Enforces role hierarchy (can't assign role higher than your own), prevents owner demotion.
  - `inviteUser()` (line 63): Creates users with `status: 'invited'`, defaults to `agent` role. Accepts `Role` type (owner/admin/agent only).
  - `removeUser()` (line 89): Soft-disables (`status: 'disabled'`), prevents self-removal and owner removal.
- **Account creation** (`src/lib/auth/create-account.ts:57`): New accounts get `role: 'owner'`. Domain-joined accounts get `role: 'agent'` (line 125).
- **SSO provisioning** (`src/lib/auth/sso-session.ts:83`): New SSO users get `role: 'agent'`.

### 1.5 UI Role Handling

- **TeamSection** (`src/components/settings/TeamSection.tsx:14`): Hardcoded `ROLE_OPTIONS = ["admin", "agent", "viewer"]` -- no owner in dropdown, no light_agent or collaborator.
- **Role badge colors** (`src/components/settings/TeamSection.tsx:23-28`): Maps `owner` (purple), `admin` (blue), `agent` (zinc), `viewer` (zinc/light).
- **Admin gating** (`src/components/settings/SettingsUserSections.tsx:37`): Team management section shown only to `owner` or `admin`.
- **No page-level RBAC**: Any authenticated user can access any page. Feature gating (`src/lib/features/gates.ts`) is tier-based (billing plan), not role-based.

### 1.6 Groups

- **Groups table** (`src/db/schema.ts:231-237`): Simple `id`, `workspaceId`, `name` columns. Used as FK on `tickets.groupId` and `time_entries.groupId`.
- **No user-group membership**: No `user_groups`, `group_members`, or any join table. Groups are labels on tickets, not containers of users.

### 1.7 MCP Tool Scopes

- **MCP scope controls** (`cli/mcp/tools/scopes.ts`): Environment-variable-based tool enablement (`MCP_ENABLED_TOOLS`). Binary on/off per tool, no role awareness.

### 1.8 What Does NOT Exist

1. `light_agent` or `collaborator` roles
2. Per-action permission checks (only hierarchy-based `requireRole`)
3. Permission definitions table or matrix
4. Custom roles with arbitrary permission sets
5. User-group membership
6. Ticket-level collaborator/sharing mechanism
7. Role-aware UI element gating (pages, buttons, form fields)
8. Seat-type billing differentiation
9. Role inheritance from groups

---

## 2. Proposed DB Schema Changes

### 2.1 Extend `userRoleEnum`

Add two new values to the existing enum at `src/db/schema.ts:105`:

```sql
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'light_agent';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'collaborator';
```

New enum: `owner`, `admin`, `agent`, `light_agent`, `collaborator`, `viewer`, `system`

### 2.2 New Table: `permissions`

Static permission definitions. Seeded on migration, not user-editable.

```sql
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(100) NOT NULL UNIQUE,
  category    VARCHAR(50) NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.3 New Table: `role_permissions`

Maps built-in roles to permissions. Seeded for all 7 built-in roles.

```sql
CREATE TABLE role_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role            user_role NOT NULL,
  permission_key  VARCHAR(100) NOT NULL REFERENCES permissions(key),
  workspace_id    UUID REFERENCES workspaces(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role, permission_key, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'))
);
CREATE INDEX role_permissions_role_idx ON role_permissions(role);
CREATE INDEX role_permissions_workspace_idx ON role_permissions(workspace_id);
```

`workspace_id` is nullable: NULL = global default, non-null = workspace-specific override.

### 2.4 New Table: `group_memberships`

User-to-group join table.

```sql
CREATE TABLE group_memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, group_id)
);
CREATE INDEX group_memberships_user_idx ON group_memberships(user_id);
CREATE INDEX group_memberships_group_idx ON group_memberships(group_id);
```

### 2.5 New Table: `ticket_collaborators`

Grants specific users access to specific tickets.

```sql
CREATE TABLE ticket_collaborators (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by     UUID REFERENCES users(id),
  can_reply    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id, user_id)
);
CREATE INDEX ticket_collaborators_ticket_idx ON ticket_collaborators(ticket_id);
CREATE INDEX ticket_collaborators_user_idx ON ticket_collaborators(user_id);
```

### 2.6 Modify `groups` Table

```sql
ALTER TABLE groups ADD COLUMN IF NOT EXISTS default_role user_role;
```

### 2.7 New Table: `custom_roles` (stretch goal)

```sql
CREATE TABLE custom_roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name         VARCHAR(100) NOT NULL,
  description  TEXT,
  base_role    user_role NOT NULL DEFAULT 'agent',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

CREATE TABLE custom_role_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id  UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key  VARCHAR(100) NOT NULL REFERENCES permissions(key),
  granted         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(custom_role_id, permission_key)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id);
```

### 2.8 Schema Change Summary

| Change | Type | Table | Phase |
|--------|------|-------|-------|
| Add `light_agent`, `collaborator` to enum | ALTER TYPE | user_role | 1 |
| New table | CREATE | permissions (~35 rows seeded) | 1 |
| New table | CREATE | role_permissions (~150 rows seeded) | 1 |
| New table | CREATE | group_memberships | 1 |
| New table | CREATE | ticket_collaborators | 1 |
| New column | ALTER | groups.default_role | 1 |
| New table | CREATE | custom_roles | stretch |
| New table | CREATE | custom_role_permissions | stretch |
| New column | ALTER | users.custom_role_id | stretch |

---

## 3. New API Routes

### 3.1 Role & Permission Management

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| GET | `/api/roles` | `requireRole('admin')` | List all built-in roles with permission summaries |
| GET | `/api/roles/[role]/permissions` | `requireRole('admin')` | Get full permission set for a specific role |
| GET | `/api/permissions` | `requireRole('admin')` | List all permission definitions by category |
| GET | `/api/users/[id]/effective-permissions` | `requireRole('admin')` | Resolved permissions for a user |

### 3.2 Custom Roles (stretch)

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| GET | `/api/roles/custom` | `requireRole('admin')` | List custom roles for workspace |
| POST | `/api/roles/custom` | `requireRole('owner')` | Create a custom role |
| PATCH | `/api/roles/custom/[id]` | `requireRole('owner')` | Update custom role |
| DELETE | `/api/roles/custom/[id]` | `requireRole('owner')` | Delete custom role (reassigns users to base_role) |
| PUT | `/api/roles/custom/[id]/permissions` | `requireRole('owner')` | Set permission overrides for custom role |

### 3.3 Group Memberships

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| GET | `/api/groups/[id]/members` | `requireAuth` | List members of a group |
| POST | `/api/groups/[id]/members` | `requireRole('admin')` | Add user(s) to group |
| DELETE | `/api/groups/[id]/members/[userId]` | `requireRole('admin')` | Remove user from group |

### 3.4 Ticket Collaborators

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| GET | `/api/tickets/[id]/collaborators` | `requirePermission('tickets:view')` | List collaborators on ticket |
| POST | `/api/tickets/[id]/collaborators` | `requirePermission('tickets:update_assignee')` | Add collaborator to ticket |
| DELETE | `/api/tickets/[id]/collaborators/[userId]` | `requirePermission('tickets:update_assignee')` | Remove collaborator |

### 3.5 Modifications to Existing Routes

| Route | Change |
|-------|--------|
| `POST /api/users/invite` | Accept `light_agent` and `collaborator` as valid roles |
| `PATCH /api/users/[id]` | Accept `light_agent` and `collaborator` as valid roles |
| `GET /api/tickets` | Add collaborator scoping: `collaborator` users see only tickets in `ticket_collaborators` |
| `GET /api/tickets/[id]` | Verify collaborator access for collaborator-role users |
| `POST /api/tickets/[id]/reply` | Block `light_agent` from public replies; block `collaborator` except internal notes |
| `PATCH /api/tickets/[id]` | Block `light_agent` from status/priority/assignee changes |
| `POST /api/tickets/create` | Block `light_agent` and `collaborator` |
| Critical write routes | Replace `requireAuth` with `requirePermission(...)` |

**Total new routes: ~15 (core) + ~5 (stretch)**

---

## 4. Permission Matrix

### 4.1 Permission Definitions (~35 permissions)

```
tickets:view              tickets:reply_public       tickets:reply_internal
tickets:create            tickets:update_status      tickets:update_priority
tickets:update_assignee   tickets:delete             tickets:merge

kb:view                   kb:edit

customers:view            customers:edit             customers:merge
customers:delete

analytics:view            analytics:export

automation:view           automation:edit

admin:users               admin:settings             admin:billing
admin:api_keys            admin:sso                  admin:roles

channels:view             channels:edit

qa:view                   qa:review

forums:view               forums:moderate

campaigns:view            campaigns:send

time:view                 time:log
```

### 4.2 Built-in Role Matrix

| Permission | owner | admin | agent | light_agent | collaborator | viewer |
|------------|:-----:|:-----:|:-----:|:-----------:|:------------:|:------:|
| tickets:view | Y | Y | Y | Y | shared only | - |
| tickets:reply_public | Y | Y | Y | **-** | - | - |
| tickets:reply_internal | Y | Y | Y | Y | Y (shared) | - |
| tickets:create | Y | Y | Y | - | - | - |
| tickets:update_status | Y | Y | Y | **-** | - | - |
| tickets:update_priority | Y | Y | Y | - | - | - |
| tickets:update_assignee | Y | Y | Y | - | - | - |
| tickets:delete | Y | Y | - | - | - | - |
| tickets:merge | Y | Y | Y | - | - | - |
| kb:view | Y | Y | Y | Y | - | Y |
| kb:edit | Y | Y | Y | - | - | - |
| customers:view | Y | Y | Y | Y | - | - |
| customers:edit | Y | Y | Y | - | - | - |
| customers:merge | Y | Y | - | - | - | - |
| customers:delete | Y | Y | - | - | - | - |
| analytics:view | Y | Y | Y | - | - | Y |
| analytics:export | Y | Y | - | - | - | - |
| automation:view | Y | Y | Y | - | - | - |
| automation:edit | Y | Y | - | - | - | - |
| admin:users | Y | Y | - | - | - | - |
| admin:settings | Y | Y | - | - | - | - |
| admin:billing | Y | - | - | - | - | - |
| admin:api_keys | Y | Y | - | - | - | - |
| admin:sso | Y | Y | - | - | - | - |
| admin:roles | Y | Y | - | - | - | - |
| channels:view | Y | Y | Y | - | - | - |
| channels:edit | Y | Y | - | - | - | - |
| qa:view | Y | Y | Y | - | - | - |
| qa:review | Y | Y | Y | - | - | - |
| forums:view | Y | Y | Y | Y | - | Y |
| forums:moderate | Y | Y | - | - | - | - |
| campaigns:view | Y | Y | Y | - | - | - |
| campaigns:send | Y | Y | - | - | - | - |
| time:view | Y | Y | Y | - | - | - |
| time:log | Y | Y | Y | - | - | - |

**Key distinctions:**

- **light_agent vs. agent**: Can view tickets and add internal notes, but cannot reply publicly, change status/priority/assignee, create tickets, or access automation/channels/qa/campaigns/time. Similar to Zendesk's Light Agent.
- **collaborator**: Can only view tickets explicitly shared via `ticket_collaborators` and add internal notes on those tickets. No access to any other module. Similar to Zendesk's Contributor/CC model.
- **viewer**: Read-only access to KB, analytics, and forums. Cannot see tickets or customer data.

---

## 5. New/Modified UI Pages & Components

### 5.1 New Components

| Component | Path | Purpose |
|-----------|------|---------|
| `RoleBadge` | `src/components/RoleBadge.tsx` | Unified role badge with color + tooltip; replaces inline badge markup in TeamSection |
| `PermissionGate` | `src/components/PermissionGate.tsx` | Client-side wrapper: renders children only if user has specified permission(s) |
| `RoleManagement` | `src/components/settings/RoleManagement.tsx` | Admin panel showing built-in role matrix, custom role CRUD (stretch) |
| `GroupMembers` | `src/components/settings/GroupMembers.tsx` | Manage group membership from settings |
| `CollaboratorPanel` | `src/components/tickets/CollaboratorPanel.tsx` | Sidebar panel on ticket detail: list/add/remove collaborators |

### 5.2 Modified Components

| Component | File | Changes |
|-----------|------|---------|
| `TeamSection` | `src/components/settings/TeamSection.tsx` | Add `light_agent` and `collaborator` to `ROLE_OPTIONS` (line 14) and `ROLE_COLORS` (line 23). Add role description tooltips. |
| `SettingsUserSections` | `src/components/settings/SettingsUserSections.tsx` | Add RoleManagement section below TeamSection (admin only). |
| `SettingsPage` | `src/app/settings/page.tsx` | Add "Roles & Permissions" card linking to `/settings/roles`. |
| Ticket detail | Ticket detail page | Hide public reply composer for `light_agent`. Show only internal note option. Hide status/priority dropdowns. Add CollaboratorPanel. |
| App navigation | Layout component | Wrap nav items in `PermissionGate`: hide Analytics for `light_agent`, hide Settings/Billing for non-admin, etc. |

### 5.3 New Pages

| Route | Purpose | Access |
|-------|---------|--------|
| `/settings/roles` | Role permission matrix display, custom role management (stretch) | admin/owner |

### 5.4 Page Access by Role

| Page | owner | admin | agent | light_agent | collaborator | viewer |
|------|:-----:|:-----:|:-----:|:-----------:|:------------:|:------:|
| `/dashboard` | Y | Y | Y | Y | limited | Y |
| `/tickets` | Y | Y | Y | Y | shared only | - |
| `/customers` | Y | Y | Y | read-only | - | - |
| `/kb` | Y | Y | Y | read-only | - | Y |
| `/analytics` | Y | Y | Y | - | - | Y |
| `/settings` | full | full | profile | profile | profile | profile |
| `/settings/roles` | Y | Y | - | - | - | - |
| `/billing` | Y | - | - | - | - | - |
| `/automation` | Y | Y | view | - | - | - |
| `/channels` | Y | Y | view | - | - | - |
| `/compliance` | Y | Y | - | - | - | - |
| `/sandbox` | Y | Y | - | - | - | - |
| `/qa` | Y | Y | Y | - | - | - |
| `/forums` | Y | Y | Y | read-only | - | Y |
| `/campaigns` | Y | Y | view | - | - | - |

---

## 6. New CLI Commands

### 6.1 Role Commands

```
cliaas roles list                              List built-in roles with permission counts
cliaas roles show <role>                       Show all permissions for a role
cliaas roles assign <userId> <role>            Assign a role to a user
cliaas roles custom list                       List custom roles (stretch)
cliaas roles custom create --name <n>          Create custom role (stretch)
cliaas roles custom delete <id>                Delete custom role (stretch)
```

### 6.2 Group Membership Commands

```
cliaas groups list                             List groups with member counts
cliaas groups members <groupId>                List members of a group
cliaas groups add-member <groupId> <userId>    Add user to group
cliaas groups remove-member <groupId> <userId> Remove user from group
```

### 6.3 Ticket Collaborator Commands

```
cliaas tickets collaborators <ticketId>                List collaborators
cliaas tickets add-collaborator <ticketId> <userId>    Share ticket with user
cliaas tickets remove-collaborator <ticketId> <userId> Revoke access
```

**Total new CLI subcommands: ~12**

---

## 7. New MCP Tools

New module: `cli/mcp/tools/rbac.ts`

| Tool | Description | Parameters |
|------|-------------|------------|
| `roles_list` | List all roles (built-in + custom) with permission summaries | none |
| `role_permissions` | Show all permissions for a given role | `role: string` |
| `user_permissions` | Show effective permissions for a user | `userId: string` |
| `roles_assign` | Assign a role to a user | `userId: string`, `role: string` |

Extended tools in existing modules:

| Tool | Module | Description | Parameters |
|------|--------|-------------|------------|
| `group_list` | customers or new | List groups with member counts | none |
| `group_members` | customers or new | List members of a group | `groupId: string` |
| `group_add_member` | customers or new | Add user to group | `groupId: string`, `userId: string` |
| `group_remove_member` | customers or new | Remove user from group | `groupId: string`, `userId: string` |
| `ticket_add_collaborator` | actions | Share ticket with user | `ticketId: string`, `userId: string` |
| `ticket_remove_collaborator` | actions | Revoke collaborator access | `ticketId: string`, `userId: string` |
| `ticket_list_collaborators` | actions | List collaborators on ticket | `ticketId: string` |

**Total new MCP tools: 11** (60 -> 71)

---

## 8. New Business Logic Module: `src/lib/rbac/`

```
src/lib/rbac/
  permissions.ts    Permission constants, categories, full matrix definition
  check.ts          hasPermission(role, perm), resolveEffectivePermissions(userId)
  middleware.ts      requirePermission(request, perm) API route guard
  seed.ts           Seed data for permissions + role_permissions tables
  types.ts          Permission, PermissionCategory, PermissionSet types
```

### Key Functions

```typescript
// permissions.ts
const PERMISSION_MATRIX: Record<BuiltinRole, string[]>  // hardcoded default matrix
function getBuiltinPermissions(role: BuiltinRole): string[]

// check.ts
async function hasPermission(userId: string, permission: string): Promise<boolean>
async function resolveEffectivePermissions(userId: string): Promise<string[]>
// Resolution order: user.role -> custom_role overrides -> group default_role (if applicable)

// middleware.ts
async function requirePermission(
  request: Request,
  permission: string | string[]
): Promise<AuthSuccess | AuthError>
// Calls getAuthUser(), then checks hasPermission(). Returns 403 if denied.
```

### Changes to Existing Auth

- `src/lib/api-auth.ts:15`: Extend `Role` to `'owner' | 'admin' | 'agent' | 'light_agent' | 'collaborator' | 'viewer'`
- `src/lib/api-auth.ts:36-40`: Extend `ROLE_HIERARCHY` with `light_agent: 1, collaborator: 0, viewer: 0`
- `src/lib/auth.ts:21-28`: Add `permissions?: string[]` to `SessionUser` (populated at login)
- `src/lib/user-service.ts:63-87`: Accept new role values in `inviteUser`, `updateUser`

### Collaborator Ticket Scoping

New function in ticket query layer or `src/lib/rbac/check.ts`:

```typescript
async function scopeTicketQuery(
  userId: string,
  role: string,
  workspaceId: string,
  baseQuery: ...
) {
  if (role === 'collaborator') {
    // Add JOIN on ticket_collaborators WHERE user_id = userId
  }
  return baseQuery;
}
```

---

## 9. Migration & Rollout Plan

### Phase 1: Schema & Permission Engine (3-4 days)

1. **Migration `0006_rbac_foundation.sql`:**
   - Add `light_agent` and `collaborator` to `user_role` enum
   - Create `permissions` table, seed ~35 permission rows
   - Create `role_permissions` table, seed ~150 rows (matrix for 6 roles x ~25 active permissions)
   - Create `group_memberships` table
   - Create `ticket_collaborators` table
   - Add `default_role` column to `groups`

2. **Business logic module:**
   - Create `src/lib/rbac/` (permissions.ts, check.ts, middleware.ts, seed.ts, types.ts)
   - `requirePermission()` guard function
   - In-memory fallback for demo/JSONL mode (hardcoded matrix, no DB lookup)

3. **Extend auth types:**
   - Update `Role` type in `src/lib/api-auth.ts`
   - Update `ROLE_HIERARCHY`
   - Add `permissions` to `SessionUser` interface

4. **Tests:**
   - Unit tests for `hasPermission()`, `resolveEffectivePermissions()`
   - Unit tests for `requirePermission()` guard
   - Integration test for permission seeding

### Phase 2: API Routes & Enforcement (4-5 days)

5. **New API routes:**
   - `GET /api/roles` -- list roles with permission summaries
   - `GET /api/roles/[role]/permissions` -- permissions for a role
   - `GET /api/permissions` -- all permission definitions
   - `GET /api/users/[id]/effective-permissions` -- resolved permissions
   - `GET/POST/DELETE /api/groups/[id]/members` -- group membership CRUD
   - `GET/POST/DELETE /api/tickets/[id]/collaborators` -- collaborator CRUD

6. **Modify existing routes:**
   - `POST /api/users/invite`, `PATCH /api/users/[id]` -- accept new roles
   - `GET /api/tickets`, `GET /api/tickets/[id]` -- collaborator scoping
   - `POST /api/tickets/[id]/reply` -- block light_agent public replies
   - `PATCH /api/tickets/[id]` -- block light_agent status changes
   - `POST /api/tickets/create` -- block light_agent and collaborator
   - Add `requirePermission()` to 15-20 critical write routes

7. **Tests:**
   - API tests: light_agent cannot reply publicly (403)
   - API tests: collaborator sees only shared tickets
   - API tests: collaborator can add internal notes to shared tickets
   - API tests: permission enforcement on critical routes

### Phase 3: UI (3-4 days)

8. **New components:**
   - `RoleBadge` -- unified badge with colors for all 7 roles
   - `PermissionGate` -- client-side permission wrapper
   - `CollaboratorPanel` -- ticket sidebar for collaborator management
   - `RoleManagement` -- settings panel showing permission matrix

9. **Modified components:**
   - `TeamSection.tsx` -- add new roles to dropdown, colors, tooltips
   - `SettingsUserSections.tsx` -- add role management section
   - Ticket detail -- hide public reply for light_agent, add collaborator panel
   - Navigation -- wrap items in PermissionGate

10. **New page:**
    - `/settings/roles` -- permission matrix display

11. **JWT permissions:**
    - Populate `permissions` array in `createToken()`
    - Read permissions client-side for `PermissionGate`

12. **Tests:**
    - Component tests for PermissionGate
    - Component tests for RoleBadge with all roles

### Phase 4: CLI & MCP (2-3 days)

13. **CLI commands:**
    - `cliaas roles list/show/assign`
    - `cliaas groups list/members/add-member/remove-member`
    - `cliaas tickets collaborators/add-collaborator/remove-collaborator`

14. **MCP tools:**
    - New module `cli/mcp/tools/rbac.ts` with 4 tools
    - Extended tools in existing modules (7 tools)
    - Register in MCP server

15. **Tests:**
    - MCP tool tests for new rbac tools

### Phase 5: Custom Roles -- Stretch (3-4 days)

16. **Migration `0007_custom_roles.sql`:**
    - Create `custom_roles`, `custom_role_permissions` tables
    - Add `users.custom_role_id` column

17. **Custom role API routes:**
    - CRUD for custom roles (5 routes)
    - Permission resolution: custom role overrides base role

18. **UI:**
    - Custom role creation form in `/settings/roles`
    - Permission toggle matrix (checkboxes per permission)

19. **CLI/MCP:**
    - `cliaas roles custom list/create/delete`
    - MCP tools for custom role management

### Phase 6: Billing Integration (1 day)

20. **Seat type differentiation:**
    - Add `fullSeats`, `lightAgentSeats` to `PlanQuotas` in `src/lib/billing/plans.ts`
    - Add seat counting to usage metrics
    - Light agents: free up to 50 per workspace
    - Collaborators/viewers: free unlimited

### Rollback Strategy

- All schema changes are additive (new enum values, new tables, new columns). No existing data is modified or deleted.
- Feature flag: `RBAC_ENABLED` environment variable. When `false`, `requirePermission()` falls back to existing `requireRole()` behavior.
- Existing role values (`owner`, `admin`, `agent`) continue to work identically -- same permissions they had before, just now explicitly codified in the matrix.
- New roles (`light_agent`, `collaborator`) only take effect when explicitly assigned.
- Demo mode: hardcoded admin-with-all-permissions behavior preserved.

---

## 10. Effort Estimate

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1: Schema & Permission Engine | Migration, RBAC module, types, tests | 3-4 days |
| Phase 2: API Routes & Enforcement | ~15 new routes, modify ~10 existing, tests | 4-5 days |
| Phase 3: UI | ~5 new components, modify ~5 existing, 1 new page, tests | 3-4 days |
| Phase 4: CLI & MCP | ~12 CLI subcommands, ~11 MCP tools, tests | 2-3 days |
| Phase 5: Custom Roles (stretch) | Schema, API, UI, CLI/MCP | 3-4 days |
| Phase 6: Billing Integration | Seat types, usage metrics | 1 day |
| **Total (phases 1-4)** | | **12-16 days (L)** |
| **Total (phases 1-6)** | | **16-21 days (XL)** |

### Risk Factors

1. **Auth coverage gap**: The ARCHITECTURE.md notes ~88% of routes lack auth checks. RBAC is only as strong as its enforcement. Consider a parallel sweep to add `requirePermission()` to all unguarded routes.
2. **JWT size**: Adding ~35 permission strings to JWT increases token size by ~500 bytes. Acceptable, but consider switching to a permission bitfield if token size becomes an issue.
3. **Collaborator query performance**: `ticket_collaborators` JOIN on every ticket query for collaborator users. Mitigated by index on `(user_id, ticket_id)`.
4. **Demo/JSONL mode**: No DB tables in demo mode. The RBAC module needs an in-memory fallback using the hardcoded matrix. Current demo user (`src/lib/api-auth.ts:28-34`) gets `admin` role with all permissions -- this behavior must be preserved.
5. **Migration safety**: `ALTER TYPE ... ADD VALUE` cannot be run inside a transaction in PostgreSQL. The migration script must use separate statements or `IF NOT EXISTS`.

### Estimated Impact

- **New files**: ~15 (RBAC module, API routes, components, MCP tools, CLI commands, migration)
- **Modified files**: ~20 (auth, middleware, schema, user-service, settings components, ticket routes, billing)
- **New LOC**: ~3,000-4,000 (core) + ~1,500 (stretch)
- **New DB tables**: 4 (core) + 2 (stretch)
- **New MCP tools**: 11 (60 -> 71)
- **New API routes**: ~15 (core) + ~5 (stretch)

---

## 11. Key Files Reference

| File | Line(s) | Relevance |
|------|---------|-----------|
| `src/db/schema.ts` | 105-110 | `userRoleEnum` -- needs `light_agent`, `collaborator` |
| `src/db/schema.ts` | 157-178 | `users` table -- role column, needs `custom_role_id` (stretch) |
| `src/db/schema.ts` | 231-237 | `groups` table -- needs `default_role` column |
| `src/db/schema.ts` | 287-322 | `tickets` table -- collaborator scoping needed |
| `src/db/schema.ts` | 856-876 | `apiKeys` table -- scopes already exist, align with RBAC |
| `src/lib/api-auth.ts` | 15 | `Role` type -- extend to include new roles |
| `src/lib/api-auth.ts` | 36-40 | `ROLE_HIERARCHY` -- extend with new roles |
| `src/lib/api-auth.ts` | 92-231 | Guard functions -- add `requirePermission()` |
| `src/lib/api-auth.ts` | 134-144 | `VALID_SCOPES` -- align with permission keys |
| `src/lib/api-keys.ts` | 132-177 | `validateApiKey()` -- returns AuthUser with role/scopes |
| `src/lib/user-service.ts` | 36-87 | `updateUser`, `inviteUser` -- accept new roles |
| `src/lib/auth.ts` | 21-28 | `SessionUser` -- add `permissions` field |
| `src/lib/auth.ts` | 30-36 | `createToken` -- include permissions in JWT |
| `src/lib/auth/create-account.ts` | 57, 125 | Account creation -- hardcoded roles |
| `src/lib/auth/sso-session.ts` | 83 | SSO user creation -- hardcoded agent role |
| `src/lib/features/gates.ts` | 1-119 | Feature gating -- tier-based, may need role layer |
| `src/lib/security/access-review.ts` | 1-96 | Access review -- hardcoded demo data, should use real DB |
| `src/middleware.ts` | 86, 254-258 | Internal headers, JWT claim extraction |
| `src/components/settings/TeamSection.tsx` | 14, 23-28 | Role options, badge colors |
| `src/components/settings/SettingsUserSections.tsx` | 37 | Admin gating check |
| `src/app/api/users/[id]/route.ts` | 11, 38 | `requireRole('admin')` examples |
| `src/app/api/users/invite/route.ts` | 8 | `requireRole('admin')` for invite |
| `cli/mcp/tools/scopes.ts` | 1-61 | MCP tool scope config -- no role awareness |
| `src/lib/billing/plans.ts` | 9-13 | `PlanQuotas` -- needs seat types |
