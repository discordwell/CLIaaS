-- Migration 0005: Feature Parity Sprint
-- Covers: Customer 360, Time Tracking, Forums, QA, Campaigns, Telegram, Slack, Teams, SDK

-- Enum ADD VALUE must be outside transaction
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'slack';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'teams';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'sdk';

-- New enums
DO $$ BEGIN
  CREATE TYPE forum_thread_status AS ENUM ('open', 'closed', 'pinned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE qa_review_status AS ENUM ('pending', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE campaign_channel AS ENUM ('email', 'sms', 'whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE customer_note_type AS ENUM ('note', 'call_log', 'meeting');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Feature 1: Customer 360 Enrichment
-- ============================================================

-- Enrich customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_attributes jsonb DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS browser text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS os text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ip_address inet;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS signup_date timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS plan text;

-- Customer activities
CREATE TABLE IF NOT EXISTS customer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  activity_type text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_activities_ws_cust_idx ON customer_activities(workspace_id, customer_id);

-- Customer notes
CREATE TABLE IF NOT EXISTS customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  author_id uuid REFERENCES users(id),
  note_type customer_note_type NOT NULL DEFAULT 'note',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_notes_ws_cust_idx ON customer_notes(workspace_id, customer_id);

-- Customer segments
CREATE TABLE IF NOT EXISTS customer_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  query jsonb NOT NULL DEFAULT '{}',
  customer_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_segments_ws_idx ON customer_segments(workspace_id);

-- Customer merge log
CREATE TABLE IF NOT EXISTS customer_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  primary_customer_id uuid NOT NULL REFERENCES customers(id),
  merged_customer_id uuid NOT NULL,
  merged_data jsonb NOT NULL DEFAULT '{}',
  merged_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Feature 2: Time Tracking Enhancement
-- ============================================================

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS billable boolean DEFAULT true;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id);

-- ============================================================
-- Feature 3: Community Forums
-- ============================================================

CREATE TABLE IF NOT EXISTS forum_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  description text,
  slug text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS forum_categories_ws_slug_idx ON forum_categories(workspace_id, slug);

CREATE TABLE IF NOT EXISTS forum_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  category_id uuid NOT NULL REFERENCES forum_categories(id),
  customer_id uuid REFERENCES customers(id),
  title text NOT NULL,
  body text NOT NULL,
  status forum_thread_status NOT NULL DEFAULT 'open',
  is_pinned boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  converted_ticket_id uuid REFERENCES tickets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_threads_ws_cat_idx ON forum_threads(workspace_id, category_id);

CREATE TABLE IF NOT EXISTS forum_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  thread_id uuid NOT NULL REFERENCES forum_threads(id),
  customer_id uuid REFERENCES customers(id),
  body text NOT NULL,
  is_best_answer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forum_replies_thread_idx ON forum_replies(thread_id);

-- ============================================================
-- Feature 4: QA / Conversation Review
-- ============================================================

CREATE TABLE IF NOT EXISTS qa_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_scorecards_ws_idx ON qa_scorecards(workspace_id);

CREATE TABLE IF NOT EXISTS qa_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  ticket_id uuid REFERENCES tickets(id),
  conversation_id uuid REFERENCES conversations(id),
  scorecard_id uuid NOT NULL REFERENCES qa_scorecards(id),
  reviewer_id uuid REFERENCES users(id),
  review_type text NOT NULL DEFAULT 'manual',
  scores jsonb NOT NULL DEFAULT '{}',
  total_score integer NOT NULL DEFAULT 0,
  max_possible_score integer NOT NULL DEFAULT 0,
  notes text,
  status qa_review_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_reviews_ws_ticket_idx ON qa_reviews(workspace_id, ticket_id);

-- ============================================================
-- Feature 5: Proactive/Outbound Messaging
-- ============================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  channel campaign_channel NOT NULL DEFAULT 'email',
  status campaign_status NOT NULL DEFAULT 'draft',
  subject text,
  template_body text,
  template_variables jsonb DEFAULT '{}',
  segment_query jsonb DEFAULT '{}',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_ws_status_idx ON campaigns(workspace_id, status);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  customer_id uuid REFERENCES customers(id),
  email text,
  phone text,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  error text
);
CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx ON campaign_recipients(campaign_id);

-- ============================================================
-- Feature 6: Telegram
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_bot_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  bot_token text NOT NULL,
  bot_username text,
  webhook_secret text NOT NULL,
  inbox_id uuid REFERENCES inboxes(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_bot_configs_ws_idx ON telegram_bot_configs(workspace_id);

-- ============================================================
-- Feature 7: Slack as Intake
-- ============================================================

CREATE TABLE IF NOT EXISTS slack_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  slack_channel_id text NOT NULL,
  slack_channel_name text,
  inbox_id uuid REFERENCES inboxes(id),
  auto_create_tickets boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS slack_mappings_ws_channel_idx ON slack_channel_mappings(workspace_id, slack_channel_id);

-- ============================================================
-- Feature 8: MS Teams as Intake
-- ============================================================

CREATE TABLE IF NOT EXISTS teams_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  teams_channel_id text NOT NULL,
  teams_team_id text NOT NULL,
  teams_channel_name text,
  inbox_id uuid REFERENCES inboxes(id),
  auto_create_tickets boolean NOT NULL DEFAULT true,
  service_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_mappings_ws_channel_idx ON teams_channel_mappings(workspace_id, teams_channel_id);
