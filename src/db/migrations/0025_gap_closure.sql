-- Migration 0025: Gap Closure (Features 1-15)
-- AI Procedures, Rule Versions, Sync Health

-- AI Procedures (Feature 1)
CREATE TABLE IF NOT EXISTS ai_procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  trigger_topics TEXT[] DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_procedures_workspace ON ai_procedures(workspace_id);

-- Rule Versions (Feature 3)
CREATE TABLE IF NOT EXISTS rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  version_number INT NOT NULL,
  name TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_rule_versions_rule ON rule_versions(rule_id);

-- Sync Health (Feature 6)
CREATE TABLE IF NOT EXISTS sync_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  cursor_state JSONB DEFAULT '{}',
  records_synced INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, connector)
);
CREATE INDEX IF NOT EXISTS idx_sync_health_workspace ON sync_health(workspace_id);
