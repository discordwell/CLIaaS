-- Migration 0007: Workforce Management
-- Covers: Schedule templates, agent schedules, shifts, time-off requests,
--         agent status log, volume snapshots, business hours

-- New enum for time-off request status
DO $$ BEGIN
  CREATE TYPE time_off_status AS ENUM ('pending', 'approved', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend existing agent_availability enum with 'on_break'
DO $$ BEGIN
  ALTER TYPE agent_availability ADD VALUE IF NOT EXISTS 'on_break';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Table 1: Schedule Templates (reusable shift patterns)
-- ============================================================

CREATE TABLE IF NOT EXISTS schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  shifts jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedule_templates_workspace_idx
  ON schedule_templates(workspace_id);

-- ============================================================
-- Table 2: Agent Schedules (per-agent date-range assignments)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  template_id uuid REFERENCES schedule_templates(id),
  effective_from date NOT NULL,
  effective_to date,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_schedules_workspace_user_idx
  ON agent_schedules(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS agent_schedules_effective_idx
  ON agent_schedules(user_id, effective_from, effective_to);

-- ============================================================
-- Table 3: Schedule Shifts (individual shift blocks per schedule)
-- ============================================================

CREATE TABLE IF NOT EXISTS schedule_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  activity text NOT NULL DEFAULT 'work',
  label text
);

CREATE INDEX IF NOT EXISTS schedule_shifts_schedule_idx
  ON schedule_shifts(schedule_id);

-- ============================================================
-- Table 4: Time-Off Requests
-- ============================================================

CREATE TABLE IF NOT EXISTS time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status time_off_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_off_requests_workspace_status_idx
  ON time_off_requests(workspace_id, status);

CREATE INDEX IF NOT EXISTS time_off_requests_user_idx
  ON time_off_requests(user_id);

-- ============================================================
-- Table 5: Agent Status Log (real-time availability tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status agent_availability NOT NULL,
  reason text,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_status_log_workspace_user_idx
  ON agent_status_log(workspace_id, user_id, started_at);

-- ============================================================
-- Table 6: Volume Snapshots (hourly ticket volume metrics)
-- ============================================================

CREATE TABLE IF NOT EXISTS volume_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  snapshot_hour timestamptz NOT NULL,
  channel text,
  tickets_created integer NOT NULL DEFAULT 0,
  tickets_resolved integer NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, snapshot_hour, channel)
);

CREATE INDEX IF NOT EXISTS volume_snapshots_workspace_hour_idx
  ON volume_snapshots(workspace_id, snapshot_hour);

-- ============================================================
-- Table 7: Business Hours (workspace/group-level schedules)
-- ============================================================

CREATE TABLE IF NOT EXISTS business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  schedule jsonb NOT NULL DEFAULT '{}',
  holidays jsonb NOT NULL DEFAULT '[]',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_hours_workspace_idx
  ON business_hours(workspace_id);

-- ============================================================
-- ALTER existing tables
-- ============================================================

-- Add timezone column to users table
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN timezone text DEFAULT 'UTC';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add business_hours_id to groups table
DO $$ BEGIN
  ALTER TABLE groups ADD COLUMN business_hours_id uuid REFERENCES business_hours(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
