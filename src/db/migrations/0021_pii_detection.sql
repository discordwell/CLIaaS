-- Migration 0021: PII Detection, Masking & HIPAA Compliance
-- Plan 16: PII Masking & HIPAA

-- New enums
CREATE TYPE pii_type AS ENUM (
  'ssn', 'credit_card', 'phone', 'email', 'address',
  'dob', 'medical_id', 'passport', 'drivers_license', 'custom'
);

CREATE TYPE pii_detection_status AS ENUM (
  'pending', 'confirmed', 'dismissed', 'redacted', 'auto_redacted'
);

CREATE TYPE pii_scan_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

-- PII detections: stores detected PII findings
CREATE TABLE pii_detections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  pii_type        pii_type NOT NULL,
  char_offset     INTEGER NOT NULL,
  char_length     INTEGER NOT NULL,
  original_encrypted BYTEA,
  masked_value    TEXT NOT NULL,
  confidence      REAL NOT NULL,
  detection_method TEXT NOT NULL,
  status          pii_detection_status NOT NULL DEFAULT 'pending',
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  redacted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_detections_workspace_status_idx ON pii_detections(workspace_id, status);
CREATE INDEX pii_detections_entity_idx ON pii_detections(entity_type, entity_id);
CREATE INDEX pii_detections_type_idx ON pii_detections(workspace_id, pii_type);

ALTER TABLE pii_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_detections_workspace_isolation ON pii_detections
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- PII redaction log: immutable record of what was redacted
CREATE TABLE pii_redaction_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  detection_id    UUID NOT NULL REFERENCES pii_detections(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  original_hash   TEXT NOT NULL,
  masked_value    TEXT NOT NULL,
  redacted_by     UUID NOT NULL REFERENCES users(id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_redaction_log_workspace_idx ON pii_redaction_log(workspace_id, created_at);
CREATE INDEX pii_redaction_log_entity_idx ON pii_redaction_log(entity_type, entity_id);

ALTER TABLE pii_redaction_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_redaction_log_workspace_isolation ON pii_redaction_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- PII access log: tracks who viewed unmasked PII
CREATE TABLE pii_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  pii_type        TEXT NOT NULL,
  access_type     TEXT NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_access_log_workspace_idx ON pii_access_log(workspace_id, created_at);
CREATE INDEX pii_access_log_user_idx ON pii_access_log(user_id, created_at);

ALTER TABLE pii_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_access_log_workspace_isolation ON pii_access_log
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- PII scan jobs: tracks retroactive scan progress
CREATE TABLE pii_scan_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  started_by      UUID NOT NULL REFERENCES users(id),
  entity_types    TEXT[] NOT NULL,
  status          pii_scan_status NOT NULL DEFAULT 'queued',
  total_records   INTEGER DEFAULT 0,
  scanned_records INTEGER DEFAULT 0,
  detections_found INTEGER DEFAULT 0,
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pii_scan_jobs_workspace_idx ON pii_scan_jobs(workspace_id, status);

ALTER TABLE pii_scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_scan_jobs_workspace_isolation ON pii_scan_jobs
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- PII sensitivity rules: per-workspace PII detection config
CREATE TABLE pii_sensitivity_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  pii_type        pii_type NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  auto_redact     BOOLEAN NOT NULL DEFAULT false,
  custom_pattern  TEXT,
  masking_style   TEXT NOT NULL DEFAULT 'full',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, pii_type)
);

ALTER TABLE pii_sensitivity_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_sensitivity_rules_workspace_isolation ON pii_sensitivity_rules
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- HIPAA BAA records
CREATE TABLE hipaa_baa_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),
  partner_name    TEXT NOT NULL,
  partner_email   TEXT NOT NULL,
  signed_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  document_url    TEXT,
  document_hash   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hipaa_baa_workspace_idx ON hipaa_baa_records(workspace_id, status);

ALTER TABLE hipaa_baa_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY hipaa_baa_records_workspace_isolation ON hipaa_baa_records
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);

-- Column additions to existing tables
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_redacted TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS has_pii BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pii_scanned_at TIMESTAMPTZ;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS has_pii BOOLEAN DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pii_scanned_at TIMESTAMPTZ;

ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS pii_category TEXT;
