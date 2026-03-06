-- 0015: Custom roles and billing seat types

-- 1. Custom roles
CREATE TABLE IF NOT EXISTS custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  base_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS custom_roles_workspace_idx ON custom_roles(workspace_id);

-- 2. Custom role permission overrides
CREATE TABLE IF NOT EXISTS custom_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (custom_role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS custom_role_permissions_role_idx ON custom_role_permissions(custom_role_id);

-- 3. Add custom_role_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id);

-- 4. RLS
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_role_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'custom_roles_workspace_isolation') THEN
    CREATE POLICY custom_roles_workspace_isolation ON custom_roles
      USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
  END IF;
END $$;
