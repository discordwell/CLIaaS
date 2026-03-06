-- Slice 13: Custom Reports & Analytics
-- 6 tables for report engine, dashboards, scheduling, caching, and live metrics

-- ---- Reports ----
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  metric TEXT NOT NULL,
  group_by TEXT[] DEFAULT '{}',
  filters JSONB DEFAULT '{}',
  date_range JSONB,
  visualization TEXT NOT NULL DEFAULT 'bar',
  formula TEXT,
  is_template BOOLEAN NOT NULL DEFAULT false,
  share_token VARCHAR(64) UNIQUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_workspace_idx ON reports(workspace_id);
CREATE INDEX IF NOT EXISTS reports_template_idx ON reports(is_template) WHERE is_template = true;
CREATE UNIQUE INDEX IF NOT EXISTS reports_share_token_idx ON reports(share_token) WHERE share_token IS NOT NULL;

-- ---- Dashboards ----
CREATE TABLE IF NOT EXISTS dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  layout JSONB DEFAULT '{}',
  share_token VARCHAR(64) UNIQUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboards_workspace_idx ON dashboards(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_share_token_idx ON dashboards(share_token) WHERE share_token IS NOT NULL;

-- ---- Dashboard Widgets ----
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  grid_x INTEGER NOT NULL DEFAULT 0,
  grid_y INTEGER NOT NULL DEFAULT 0,
  grid_w INTEGER NOT NULL DEFAULT 4,
  grid_h INTEGER NOT NULL DEFAULT 3,
  overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboard_widgets_dashboard_idx ON dashboard_widgets(dashboard_id);
CREATE INDEX IF NOT EXISTS dashboard_widgets_report_idx ON dashboard_widgets(report_id);

-- ---- Report Schedules ----
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  day_of_week INTEGER,
  day_of_month INTEGER,
  hour_utc INTEGER NOT NULL DEFAULT 9,
  format TEXT NOT NULL DEFAULT 'csv',
  recipients TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_frequency_check CHECK (frequency IN ('daily', 'weekly', 'monthly'))
);

CREATE INDEX IF NOT EXISTS report_schedules_workspace_idx ON report_schedules(workspace_id);
CREATE INDEX IF NOT EXISTS report_schedules_next_run_idx ON report_schedules(next_run_at) WHERE enabled = true;

-- ---- Report Cache ----
CREATE TABLE IF NOT EXISTS report_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filter_hash VARCHAR(64) NOT NULL,
  result_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_cache_lookup_idx ON report_cache(report_id, filter_hash);
CREATE INDEX IF NOT EXISTS report_cache_expiry_idx ON report_cache(expires_at);

-- ---- Metric Snapshots (live dashboard) ----
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL DEFAULT 0,
  dimensions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metric_snapshots_workspace_metric_idx ON metric_snapshots(workspace_id, metric_name, created_at);
CREATE INDEX IF NOT EXISTS metric_snapshots_created_idx ON metric_snapshots(created_at);
