-- AI Resolution: autonomous AI ticket resolution pipeline
-- Migration 0016

-- Enums
DO $$ BEGIN
  CREATE TYPE ai_resolution_status AS ENUM (
    'pending', 'auto_resolved', 'approved', 'rejected', 'edited', 'escalated', 'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ai_mode AS ENUM ('suggest', 'approve', 'auto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AI resolution audit log
CREATE TABLE IF NOT EXISTS ai_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  suggested_reply TEXT NOT NULL DEFAULT '',
  reasoning TEXT,
  kb_articles_used TEXT[] DEFAULT '{}',
  status ai_resolution_status NOT NULL DEFAULT 'pending',
  final_reply TEXT,
  actions_taken JSONB,
  escalation_reason TEXT,
  error_message TEXT,
  provider TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_cents NUMERIC(10,4),
  latency_ms INTEGER,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  csat_score SMALLINT,
  csat_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_resolutions_ticket_idx ON ai_resolutions(ticket_id);
CREATE INDEX IF NOT EXISTS ai_resolutions_workspace_status_idx ON ai_resolutions(workspace_id, status);
CREATE INDEX IF NOT EXISTS ai_resolutions_created_at_idx ON ai_resolutions(created_at);

-- Per-workspace AI agent configuration
CREATE TABLE IF NOT EXISTS ai_agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode ai_mode NOT NULL DEFAULT 'suggest',
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  excluded_topics TEXT[] DEFAULT '{}',
  kb_context BOOLEAN NOT NULL DEFAULT true,
  pii_detection BOOLEAN NOT NULL DEFAULT true,
  max_auto_resolves_per_hour INTEGER NOT NULL DEFAULT 50,
  require_kb_citation BOOLEAN NOT NULL DEFAULT false,
  channels TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, workspace_id)
);
