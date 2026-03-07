-- Migration 0028: AI Admin Controls + SCIM → DB dual-mode tables
-- Moves JSONL-only stores to proper Postgres tables with RLS

BEGIN;

-- ---- AI Channel Policies ----

CREATE TABLE IF NOT EXISTS ai_channel_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  mode TEXT NOT NULL DEFAULT 'suggest' CHECK (mode IN ('suggest', 'approve', 'auto')),
  max_auto_resolves_per_hour INTEGER NOT NULL DEFAULT 50,
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  excluded_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_channel_policies_ws_channel_idx ON ai_channel_policies(workspace_id, channel);

ALTER TABLE ai_channel_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_channel_policies_rls ON ai_channel_policies
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- AI Circuit Breaker ----

CREATE TABLE IF NOT EXISTS ai_circuit_breaker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) UNIQUE,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  half_open_attempts INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_circuit_breaker ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_circuit_breaker_rls ON ai_circuit_breaker
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- AI Audit Trail ----

CREATE TABLE IF NOT EXISTS ai_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  action TEXT NOT NULL,
  ticket_id TEXT,
  resolution_id TEXT,
  user_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_audit_trail_workspace_idx ON ai_audit_trail(workspace_id, created_at DESC);
CREATE INDEX ai_audit_trail_action_idx ON ai_audit_trail(action);

ALTER TABLE ai_audit_trail ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_audit_trail_rls ON ai_audit_trail
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- AI Usage Snapshots ----

CREATE TABLE IF NOT EXISTS ai_usage_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  period TEXT NOT NULL,
  total_requests INTEGER NOT NULL DEFAULT 0,
  auto_resolved INTEGER NOT NULL DEFAULT 0,
  escalated INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_cents NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  avg_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_usage_snapshots_ws_period_idx ON ai_usage_snapshots(workspace_id, period);

ALTER TABLE ai_usage_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_snapshots_rls ON ai_usage_snapshots
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- SCIM Users ----

CREATE TABLE IF NOT EXISTS scim_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'active',
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scim_users_ws_email_idx ON scim_users(workspace_id, email);

ALTER TABLE scim_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY scim_users_rls ON scim_users
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- SCIM Groups ----

CREATE TABLE IF NOT EXISTS scim_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scim_groups_ws_name_idx ON scim_groups(workspace_id, name);

ALTER TABLE scim_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY scim_groups_rls ON scim_groups
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- SCIM Group Members (join table) ----

CREATE TABLE IF NOT EXISTS scim_group_members (
  group_id UUID NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES scim_users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE scim_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY scim_group_members_rls ON scim_group_members
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

COMMIT;
