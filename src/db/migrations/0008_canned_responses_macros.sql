-- 0008: Canned Responses, Macros & Agent Signatures
-- Plan 07: reusable reply templates, one-click macro bundles, agent signatures

-- Scope enum shared by canned_responses and macros
CREATE TYPE template_scope AS ENUM ('personal', 'shared');

-- Canned responses: reusable reply templates with merge variables
CREATE TABLE canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,
  scope template_scope NOT NULL DEFAULT 'personal',
  shortcut TEXT,
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX canned_responses_workspace_idx ON canned_responses(workspace_id);
CREATE INDEX canned_responses_category_idx ON canned_responses(workspace_id, category);
CREATE INDEX canned_responses_created_by_idx ON canned_responses(created_by);

-- Macros: one-click multi-action bundles
CREATE TABLE macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_by UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  actions JSONB NOT NULL DEFAULT '[]',
  scope template_scope NOT NULL DEFAULT 'shared',
  enabled BOOLEAN NOT NULL DEFAULT true,
  usage_count INT NOT NULL DEFAULT 0,
  position INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX macros_workspace_idx ON macros(workspace_id);
CREATE INDEX macros_created_by_idx ON macros(created_by);

-- Agent signatures: per-agent HTML/text signatures
CREATE TABLE agent_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_signatures_workspace_idx ON agent_signatures(workspace_id);
CREATE INDEX agent_signatures_user_idx ON agent_signatures(user_id);
CREATE UNIQUE INDEX agent_signatures_user_default_idx
  ON agent_signatures(user_id) WHERE is_default = true;

-- RLS policies
ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY canned_responses_workspace_isolation ON canned_responses
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY macros_workspace_isolation ON macros
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY agent_signatures_workspace_isolation ON agent_signatures
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
