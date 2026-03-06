-- Plan 19: Campaign Orchestration — Multi-step campaigns, product tours, targeted messages
-- Migration: 0022_campaign_orchestration.sql

-- ============================================================
-- 1. New Enums
-- ============================================================

CREATE TYPE campaign_step_type AS ENUM (
  'send_email',
  'send_sms',
  'send_in_app',
  'send_push',
  'wait_delay',
  'wait_event',
  'condition',
  'branch',
  'update_tag',
  'webhook'
);

CREATE TYPE campaign_step_status AS ENUM (
  'pending',
  'active',
  'completed',
  'skipped',
  'failed'
);

CREATE TYPE in_app_message_type AS ENUM (
  'banner',
  'modal',
  'tooltip',
  'slide_in'
);

CREATE TYPE tour_step_position AS ENUM (
  'top',
  'bottom',
  'left',
  'right',
  'center'
);

-- ============================================================
-- 2. Extend Existing Enums
-- ============================================================

ALTER TYPE campaign_channel ADD VALUE IF NOT EXISTS 'in_app';
ALTER TYPE campaign_channel ADD VALUE IF NOT EXISTS 'push';

ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'completed';

-- ============================================================
-- 3. Alter Existing Tables
-- ============================================================

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS entry_step_id UUID;

-- ============================================================
-- 4. New Tables
-- ============================================================

-- 4.1 Campaign Steps (multi-step orchestration)
CREATE TABLE IF NOT EXISTS campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  step_type campaign_step_type NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  delay_seconds INTEGER,
  condition_query JSONB,
  next_step_id UUID REFERENCES campaign_steps(id),
  branch_true_step_id UUID REFERENCES campaign_steps(id),
  branch_false_step_id UUID REFERENCES campaign_steps(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaign_steps_campaign_pos_idx ON campaign_steps(campaign_id, position);

-- 4.2 Campaign Enrollments (per-customer journey state)
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  current_step_id UUID REFERENCES campaign_steps(id),
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  next_execution_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX campaign_enrollments_campaign_status_idx ON campaign_enrollments(campaign_id, status);
CREATE INDEX campaign_enrollments_customer_idx ON campaign_enrollments(customer_id);
CREATE INDEX campaign_enrollments_next_exec_idx ON campaign_enrollments(next_execution_at) WHERE status = 'active';

-- 4.3 Campaign Step Events (execution log / per-step analytics)
CREATE TABLE IF NOT EXISTS campaign_step_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES campaign_enrollments(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaign_step_events_step_type_idx ON campaign_step_events(step_id, event_type);
CREATE INDEX campaign_step_events_enrollment_idx ON campaign_step_events(enrollment_id);

-- 4.4 Product Tours
CREATE TABLE IF NOT EXISTS product_tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  target_url_pattern TEXT NOT NULL DEFAULT '*',
  segment_query JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_tours_ws_active_idx ON product_tours(workspace_id, is_active);

-- 4.5 Product Tour Steps
CREATE TABLE IF NOT EXISTS product_tour_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id UUID NOT NULL REFERENCES product_tours(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  position INTEGER NOT NULL DEFAULT 0,
  target_selector TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  placement tour_step_position NOT NULL DEFAULT 'bottom',
  highlight_target BOOLEAN NOT NULL DEFAULT true,
  action_label TEXT NOT NULL DEFAULT 'Next',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_tour_steps_tour_pos_idx ON product_tour_steps(tour_id, position);

-- 4.6 Product Tour Progress (per-customer tour state)
CREATE TABLE IF NOT EXISTS product_tour_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id UUID NOT NULL REFERENCES product_tours(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX product_tour_progress_tour_customer_idx ON product_tour_progress(tour_id, customer_id);

-- 4.7 In-App Messages
CREATE TABLE IF NOT EXISTS in_app_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  message_type in_app_message_type NOT NULL DEFAULT 'banner',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  cta_text TEXT,
  cta_url TEXT,
  target_url_pattern TEXT NOT NULL DEFAULT '*',
  segment_query JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 0,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  max_impressions INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX in_app_messages_ws_active_idx ON in_app_messages(workspace_id, is_active);

-- 4.8 In-App Message Impressions (frequency control)
CREATE TABLE IF NOT EXISTS in_app_message_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES in_app_messages(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  action TEXT NOT NULL DEFAULT 'displayed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX in_app_msg_impressions_msg_cust_idx ON in_app_message_impressions(message_id, customer_id);
CREATE INDEX in_app_msg_impressions_cust_idx ON in_app_message_impressions(customer_id);

-- ============================================================
-- 5. RLS Policies
-- ============================================================

ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_step_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tour_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tour_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_app_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_app_message_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_steps_tenant ON campaign_steps USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY campaign_enrollments_tenant ON campaign_enrollments USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY campaign_step_events_tenant ON campaign_step_events USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY product_tours_tenant ON product_tours USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY product_tour_steps_tenant ON product_tour_steps USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY product_tour_progress_tenant ON product_tour_progress USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY in_app_messages_tenant ON in_app_messages USING (workspace_id = current_setting('app.current_workspace_id')::uuid);
CREATE POLICY in_app_message_impressions_tenant ON in_app_message_impressions USING (workspace_id = current_setting('app.current_workspace_id')::uuid);

-- Add FK for entry_step_id now that campaign_steps exists
ALTER TABLE campaigns ADD CONSTRAINT campaigns_entry_step_fk FOREIGN KEY (entry_step_id) REFERENCES campaign_steps(id);
