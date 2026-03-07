-- Migration 0027: Add connector_capabilities table
-- Tracks per-connector read/write feature flags for the capability matrix

CREATE TABLE IF NOT EXISTS connector_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector TEXT NOT NULL,
  supports_read BOOLEAN NOT NULL DEFAULT TRUE,
  supports_incremental_sync BOOLEAN NOT NULL DEFAULT FALSE,
  supports_update BOOLEAN NOT NULL DEFAULT FALSE,
  supports_reply BOOLEAN NOT NULL DEFAULT FALSE,
  supports_note BOOLEAN NOT NULL DEFAULT FALSE,
  supports_create BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_capabilities_unique_idx
  ON connector_capabilities(workspace_id, connector);

-- RLS: workspace isolation
ALTER TABLE connector_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON connector_capabilities
  USING (workspace_id = current_setting('app.current_workspace_id', true)::uuid);
