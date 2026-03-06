-- Migration 0006: Marketplace & Plugin Platform
-- Covers: Plugin installations, hook registrations, execution logs, marketplace listings, reviews

-- New enum for listing status
DO $$ BEGIN
  CREATE TYPE plugin_listing_status AS ENUM ('draft', 'review', 'published', 'rejected', 'deprecated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Table 1: Marketplace Listings (global plugin catalog)
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL UNIQUE,
  manifest jsonb NOT NULL,
  status plugin_listing_status NOT NULL DEFAULT 'draft',
  published_by uuid REFERENCES users(id),
  install_count integer NOT NULL DEFAULT 0,
  average_rating numeric(3,2),
  review_count integer NOT NULL DEFAULT 0,
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings(status);

-- ============================================================
-- Table 2: Plugin Installations (workspace-scoped)
-- ============================================================

CREATE TABLE IF NOT EXISTS plugin_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  plugin_id text NOT NULL,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}',
  installed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_installations_ws_plugin_idx
  ON plugin_installations(workspace_id, plugin_id);

-- ============================================================
-- Table 3: Plugin Hook Registrations (per installation)
-- ============================================================

CREATE TABLE IF NOT EXISTS plugin_hook_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  hook_name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plugin_hook_registrations_ws_hook_idx
  ON plugin_hook_registrations(workspace_id, hook_name);

-- ============================================================
-- Table 4: Plugin Execution Logs (audit trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS plugin_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  hook_name text NOT NULL,
  status text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plugin_execution_logs_ws_inst_idx
  ON plugin_execution_logs(workspace_id, installation_id, created_at);

-- ============================================================
-- Table 5: Plugin Reviews (marketplace reviews)
-- ============================================================

CREATE TABLE IF NOT EXISTS plugin_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plugin_reviews_listing_ws_idx
  ON plugin_reviews(listing_id, workspace_id);
