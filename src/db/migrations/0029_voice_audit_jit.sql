-- Migration 0029: Voice tables, SCIM audit log, SSO JIT provisioning
-- Phase A of competitive gap closure (Plan 21)

BEGIN;

-- ---- Voice Call Direction + Status Enums ----

DO $$ BEGIN
  CREATE TYPE voice_call_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voice_call_status AS ENUM ('ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'voicemail');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voice_agent_status AS ENUM ('available', 'busy', 'offline', 'wrap-up');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- Voice Calls ----

CREATE TABLE IF NOT EXISTS voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  call_sid TEXT NOT NULL,
  direction voice_call_direction NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  status voice_call_status NOT NULL DEFAULT 'ringing',
  duration INTEGER,
  recording_url TEXT,
  transcription TEXT,
  agent_id UUID,
  ticket_id UUID,
  queue_id TEXT,
  queue_wait_ms INTEGER,
  ivr_path JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_calls_workspace_idx ON voice_calls(workspace_id);
CREATE INDEX voice_calls_call_sid_idx ON voice_calls(call_sid);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_calls_rls ON voice_calls
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- Voice Agents ----

CREATE TABLE IF NOT EXISTS voice_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status voice_agent_status NOT NULL DEFAULT 'offline',
  current_call_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_agents_workspace_idx ON voice_agents(workspace_id);

ALTER TABLE voice_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_agents_rls ON voice_agents
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- Voice Queue Metrics ----

CREATE TABLE IF NOT EXISTS voice_queue_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  queue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  waiting_calls INTEGER NOT NULL DEFAULT 0,
  avg_wait_ms INTEGER NOT NULL DEFAULT 0,
  longest_wait_ms INTEGER NOT NULL DEFAULT 0,
  available_agents INTEGER NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_queue_metrics_workspace_idx ON voice_queue_metrics(workspace_id);
CREATE INDEX voice_queue_metrics_timestamp_idx ON voice_queue_metrics(timestamp);

ALTER TABLE voice_queue_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY voice_queue_metrics_rls ON voice_queue_metrics
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- SCIM Audit Log ----

CREATE TABLE IF NOT EXISTS scim_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT,
  changes JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scim_audit_workspace_idx ON scim_audit_log(workspace_id);
CREATE INDEX scim_audit_timestamp_idx ON scim_audit_log(timestamp);
CREATE INDEX scim_audit_entity_idx ON scim_audit_log(entity_type, entity_id);

ALTER TABLE scim_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY scim_audit_log_rls ON scim_audit_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- ---- SSO JIT Provisioning fields ----

ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS default_role TEXT DEFAULT 'agent';
ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS jit_enabled BOOLEAN NOT NULL DEFAULT true;

COMMIT;
