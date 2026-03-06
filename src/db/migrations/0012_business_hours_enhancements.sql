-- 0012: Business hours enhancements — holiday calendars, SLA + brand links
-- Depends on: 0007 (business_hours table)

-- Holiday calendars
CREATE TABLE IF NOT EXISTS holiday_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holiday_calendars_workspace_idx ON holiday_calendars(workspace_id);

-- Holiday entries (belong to a calendar)
CREATE TABLE IF NOT EXISTS holiday_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holiday_entries_calendar_idx ON holiday_entries(calendar_id);

-- Join table: business_hours <-> holiday_calendars (many-to-many)
CREATE TABLE IF NOT EXISTS business_hours_holiday_links (
  business_hours_id UUID NOT NULL REFERENCES business_hours(id) ON DELETE CASCADE,
  holiday_calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  PRIMARY KEY (business_hours_id, holiday_calendar_id)
);

-- SLA policies can reference a business hours schedule
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS business_hours_id UUID REFERENCES business_hours(id);

-- Brands can reference a business hours schedule
ALTER TABLE brands ADD COLUMN IF NOT EXISTS business_hours_id UUID REFERENCES business_hours(id);

-- RLS policies for holiday_calendars
ALTER TABLE holiday_calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY holiday_calendars_workspace_isolation ON holiday_calendars
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
