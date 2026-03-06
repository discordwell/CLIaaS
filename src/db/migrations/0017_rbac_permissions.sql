-- 0017: RBAC — permissions, role_permissions, group_memberships, ticket_collaborators
-- Depends on 0016_rbac_enum_values.sql (light_agent, collaborator enum values)

-- 1. Permissions catalog (system-seeded, not user-editable)
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  bit_index INTEGER NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Built-in role → permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role, permission_key, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'))
);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions(role);
CREATE INDEX IF NOT EXISTS role_permissions_workspace_idx ON role_permissions(workspace_id)
  WHERE workspace_id IS NOT NULL;

-- 3. Group memberships (DB-backed, replaces JSONL for DB mode)
CREATE TABLE IF NOT EXISTS group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id, group_id)
);

CREATE INDEX IF NOT EXISTS group_memberships_group_idx ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS group_memberships_user_idx ON group_memberships(user_id);

-- 4. Ticket collaborators
CREATE TABLE IF NOT EXISTS ticket_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id),
  can_reply BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS ticket_collaborators_ticket_idx ON ticket_collaborators(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_collaborators_user_idx ON ticket_collaborators(user_id);

-- 5. Add default_role column to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS default_role TEXT DEFAULT 'agent';

-- 6. RLS policies
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_collaborators ENABLE ROW LEVEL SECURITY;

-- Read-only policy for permissions catalog (global, not workspace-scoped)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'permissions_read_all') THEN
    CREATE POLICY permissions_read_all ON permissions FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'group_memberships_workspace_isolation') THEN
    CREATE POLICY group_memberships_workspace_isolation ON group_memberships
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ticket_collaborators_workspace_isolation') THEN
    CREATE POLICY ticket_collaborators_workspace_isolation ON ticket_collaborators
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;
