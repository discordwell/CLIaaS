-- 0020: Routing tables for omnichannel routing engine
-- Idempotent — safe to re-run.

-- Enums
DO $$ BEGIN
  CREATE TYPE routing_strategy AS ENUM ('round_robin', 'load_balanced', 'skill_match', 'priority_weighted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE routing_target_type AS ENUM ('queue', 'group', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Agent skills
CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  proficiency REAL NOT NULL DEFAULT 1.0 CHECK (proficiency >= 0 AND proficiency <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, skill_name)
);

-- Agent capacity rules
CREATE TABLE IF NOT EXISTS agent_capacity_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  max_concurrent INT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_type)
);

-- Routing queues
CREATE TABLE IF NOT EXISTS routing_queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  priority INT NOT NULL DEFAULT 0,
  conditions JSONB NOT NULL DEFAULT '{}',
  strategy routing_strategy NOT NULL DEFAULT 'skill_match',
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  overflow_queue_id UUID REFERENCES routing_queues(id) ON DELETE SET NULL,
  overflow_timeout_secs INT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Routing rules
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  conditions JSONB NOT NULL DEFAULT '{}',
  target_type routing_target_type NOT NULL,
  target_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Routing log
CREATE TABLE IF NOT EXISTS routing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL,
  queue_id UUID REFERENCES routing_queues(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES routing_rules(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  strategy routing_strategy NOT NULL,
  matched_skills TEXT[] NOT NULL DEFAULT '{}',
  scores JSONB NOT NULL DEFAULT '{}',
  reasoning TEXT NOT NULL DEFAULT '',
  duration_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_log_ticket ON routing_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_routing_log_created ON routing_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_log_workspace ON routing_log(workspace_id, created_at DESC);

-- Group memberships
CREATE TABLE IF NOT EXISTS group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- Extend users table for routing
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'offline';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Extend groups table for routing
ALTER TABLE groups ADD COLUMN IF NOT EXISTS default_strategy routing_strategy DEFAULT 'skill_match';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS business_hours_id UUID;

-- Extend tickets table for routing
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS routed_via TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS queue_id UUID REFERENCES routing_queues(id) ON DELETE SET NULL;
