-- AutoQA Pipeline, Satisfaction Prediction & Customer Health Scores
-- Plan 17: Replace random QA scores with real LLM analysis

-- AutoQA configuration per workspace
CREATE TABLE IF NOT EXISTS autoqa_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  enabled BOOLEAN NOT NULL DEFAULT false,
  scorecard_id UUID REFERENCES qa_scorecards(id),
  trigger_on_resolved BOOLEAN NOT NULL DEFAULT true,
  trigger_on_closed BOOLEAN NOT NULL DEFAULT false,
  provider TEXT NOT NULL DEFAULT 'claude',
  model TEXT,
  sample_rate NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  custom_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

-- AI-generated flags on conversations (spotlight)
CREATE TABLE IF NOT EXISTS qa_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  review_id UUID NOT NULL REFERENCES qa_reviews(id),
  ticket_id UUID REFERENCES tickets(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_by UUID REFERENCES users(id),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_flags_ws_severity_idx ON qa_flags(workspace_id, severity) WHERE NOT dismissed;
CREATE INDEX IF NOT EXISTS qa_flags_review_idx ON qa_flags(review_id);

-- Coaching assignments
CREATE TABLE IF NOT EXISTS qa_coaching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  review_id UUID NOT NULL REFERENCES qa_reviews(id),
  agent_id UUID NOT NULL REFERENCES users(id),
  assigned_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  agent_response TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS qa_coaching_ws_agent_idx ON qa_coaching_assignments(workspace_id, agent_id, status);

-- Satisfaction predictions per ticket
CREATE TABLE IF NOT EXISTS csat_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  predicted_score NUMERIC(3,1) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  risk_level TEXT NOT NULL,
  factors JSONB NOT NULL DEFAULT '{}',
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actual_score INTEGER,
  actual_received_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS csat_predictions_ws_ticket_idx ON csat_predictions(workspace_id, ticket_id);
CREATE INDEX IF NOT EXISTS csat_predictions_ws_risk_idx ON csat_predictions(workspace_id, risk_level);

-- Customer health scores
CREATE TABLE IF NOT EXISTS customer_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  overall_score INTEGER NOT NULL,
  csat_score INTEGER,
  sentiment_score INTEGER,
  effort_score INTEGER,
  resolution_score INTEGER,
  engagement_score INTEGER,
  trend TEXT NOT NULL DEFAULT 'stable',
  previous_score INTEGER,
  signals JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, customer_id)
);
CREATE INDEX IF NOT EXISTS customer_health_ws_score_idx ON customer_health_scores(workspace_id, overall_score);

-- Calibration sessions
CREATE TABLE IF NOT EXISTS qa_calibration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS qa_calibration_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES qa_calibration_sessions(id),
  auto_review_id UUID NOT NULL REFERENCES qa_reviews(id),
  manual_review_id UUID REFERENCES qa_reviews(id),
  score_delta NUMERIC(4,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_calibration_entries_session_idx ON qa_calibration_entries(session_id);

-- Add agent_id and AI metadata to qa_reviews
ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES users(id);
ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS ai_latency_ms INTEGER;
ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS suggestions JSONB DEFAULT '[]';
CREATE INDEX IF NOT EXISTS qa_reviews_ws_agent_idx ON qa_reviews(workspace_id, agent_id);

-- Add predicted_csat and autoqa_score to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS predicted_csat NUMERIC(3,1);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS autoqa_score NUMERIC(3,1);

-- Add health_score and health_trend to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS health_score INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS health_trend TEXT;
