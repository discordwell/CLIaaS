-- Plan 18: Visual Chatbot Builder
-- Extends chatbots table, adds version history, persistent sessions, and analytics

-- Extend chatbots table
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS status text DEFAULT 'published' NOT NULL;
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS published_flow jsonb;
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS channels jsonb DEFAULT '["web"]'::jsonb;
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS description text;

-- Chatbot version history (for rollback)
CREATE TABLE IF NOT EXISTS chatbot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id uuid NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  version integer NOT NULL,
  flow jsonb NOT NULL,
  summary text,
  created_by text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(chatbot_id, version)
);
CREATE INDEX IF NOT EXISTS chatbot_versions_chatbot_idx ON chatbot_versions(chatbot_id, version DESC);

-- Persistent chatbot sessions
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id uuid NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  chat_session_id text,
  state jsonb NOT NULL,
  channel text DEFAULT 'web',
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz,
  outcome text -- 'completed' | 'abandoned' | 'handoff'
);
CREATE INDEX IF NOT EXISTS chatbot_sessions_chatbot_idx ON chatbot_sessions(chatbot_id, started_at DESC);

-- Per-node daily analytics aggregation
CREATE TABLE IF NOT EXISTS chatbot_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id uuid NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  date date NOT NULL,
  entries integer DEFAULT 0 NOT NULL,
  exits integer DEFAULT 0 NOT NULL,
  drop_offs integer DEFAULT 0 NOT NULL,
  avg_time_seconds real,
  UNIQUE(chatbot_id, node_id, date)
);
CREATE INDEX IF NOT EXISTS chatbot_analytics_chatbot_date_idx ON chatbot_analytics(chatbot_id, date DESC);
