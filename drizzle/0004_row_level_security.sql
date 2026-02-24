-- Migration 0004: Row-Level Security (Week 5, Phase 3)
-- Denormalizes workspace_id into child tables, enables RLS, creates policies.

-- ============================================================================
-- Step 1: Add workspace_id columns to 15 child tables (nullable initially)
-- ============================================================================

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "ticket_tags" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "csat_ratings" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "sla_events" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "kb_categories" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "kb_revisions" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "external_objects" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "sync_cursors" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "raw_records" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");
ALTER TABLE "custom_field_values" ADD COLUMN IF NOT EXISTS "workspace_id" uuid REFERENCES "workspaces"("id");

-- ============================================================================
-- Step 2: Backfill workspace_id from parent tables
-- ============================================================================

-- conversations → tickets
UPDATE "conversations" c SET "workspace_id" = t."workspace_id"
FROM "tickets" t WHERE c."ticket_id" = t."id" AND c."workspace_id" IS NULL;

-- messages → conversations → tickets
UPDATE "messages" m SET "workspace_id" = c."workspace_id"
FROM "conversations" c WHERE m."conversation_id" = c."id" AND m."workspace_id" IS NULL;

-- attachments → messages
UPDATE "attachments" a SET "workspace_id" = m."workspace_id"
FROM "messages" m WHERE a."message_id" = m."id" AND a."workspace_id" IS NULL;

-- ticket_tags → tickets
UPDATE "ticket_tags" tt SET "workspace_id" = t."workspace_id"
FROM "tickets" t WHERE tt."ticket_id" = t."id" AND tt."workspace_id" IS NULL;

-- csat_ratings → tickets
UPDATE "csat_ratings" cr SET "workspace_id" = t."workspace_id"
FROM "tickets" t WHERE cr."ticket_id" = t."id" AND cr."workspace_id" IS NULL;

-- time_entries → tickets
UPDATE "time_entries" te SET "workspace_id" = t."workspace_id"
FROM "tickets" t WHERE te."ticket_id" = t."id" AND te."workspace_id" IS NULL;

-- sla_events → tickets
UPDATE "sla_events" se SET "workspace_id" = t."workspace_id"
FROM "tickets" t WHERE se."ticket_id" = t."id" AND se."workspace_id" IS NULL;

-- kb_categories → kb_collections
UPDATE "kb_categories" kc SET "workspace_id" = col."workspace_id"
FROM "kb_collections" col WHERE kc."collection_id" = col."id" AND kc."workspace_id" IS NULL;

-- kb_revisions → kb_articles
UPDATE "kb_revisions" kr SET "workspace_id" = a."workspace_id"
FROM "kb_articles" a WHERE kr."article_id" = a."id" AND kr."workspace_id" IS NULL;

-- external_objects → integrations
UPDATE "external_objects" eo SET "workspace_id" = i."workspace_id"
FROM "integrations" i WHERE eo."integration_id" = i."id" AND eo."workspace_id" IS NULL;

-- sync_cursors → integrations
UPDATE "sync_cursors" sc SET "workspace_id" = i."workspace_id"
FROM "integrations" i WHERE sc."integration_id" = i."id" AND sc."workspace_id" IS NULL;

-- import_jobs → integrations
UPDATE "import_jobs" ij SET "workspace_id" = i."workspace_id"
FROM "integrations" i WHERE ij."integration_id" = i."id" AND ij."workspace_id" IS NULL;

-- export_jobs → integrations
UPDATE "export_jobs" ej SET "workspace_id" = i."workspace_id"
FROM "integrations" i WHERE ej."integration_id" = i."id" AND ej."workspace_id" IS NULL;

-- raw_records → integrations
UPDATE "raw_records" rr SET "workspace_id" = i."workspace_id"
FROM "integrations" i WHERE rr."integration_id" = i."id" AND rr."workspace_id" IS NULL;

-- custom_field_values → custom_fields
UPDATE "custom_field_values" cfv SET "workspace_id" = cf."workspace_id"
FROM "custom_fields" cf WHERE cfv."field_id" = cf."id" AND cfv."workspace_id" IS NULL;

-- ============================================================================
-- Step 3: Create indexes on new workspace_id columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS "conversations_workspace_idx" ON "conversations" ("workspace_id");
CREATE INDEX IF NOT EXISTS "messages_workspace_idx" ON "messages" ("workspace_id");
CREATE INDEX IF NOT EXISTS "attachments_workspace_idx" ON "attachments" ("workspace_id");
CREATE INDEX IF NOT EXISTS "ticket_tags_workspace_idx" ON "ticket_tags" ("workspace_id");
CREATE INDEX IF NOT EXISTS "csat_ratings_workspace_idx" ON "csat_ratings" ("workspace_id");
CREATE INDEX IF NOT EXISTS "time_entries_workspace_idx" ON "time_entries" ("workspace_id");
CREATE INDEX IF NOT EXISTS "sla_events_workspace_idx" ON "sla_events" ("workspace_id");
CREATE INDEX IF NOT EXISTS "kb_categories_workspace_idx" ON "kb_categories" ("workspace_id");
CREATE INDEX IF NOT EXISTS "kb_revisions_workspace_idx" ON "kb_revisions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "external_objects_workspace_idx" ON "external_objects" ("workspace_id");
CREATE INDEX IF NOT EXISTS "sync_cursors_workspace_idx" ON "sync_cursors" ("workspace_id");
CREATE INDEX IF NOT EXISTS "import_jobs_workspace_idx" ON "import_jobs" ("workspace_id");
CREATE INDEX IF NOT EXISTS "export_jobs_workspace_idx" ON "export_jobs" ("workspace_id");
CREATE INDEX IF NOT EXISTS "raw_records_workspace_idx" ON "raw_records" ("workspace_id");
CREATE INDEX IF NOT EXISTS "custom_field_values_workspace_idx" ON "custom_field_values" ("workspace_id");

-- ============================================================================
-- Step 4: Enable RLS on all workspace-scoped tables
-- ============================================================================

-- Tables already having workspace_id (19)
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sla_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;

-- Newly denormalized tables (15)
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "csat_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sla_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kb_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "raw_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;

-- Compliance tables
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gdpr_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;

-- Tenant-level tables
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Step 5: Create RLS policies for workspace-scoped tables
-- ============================================================================

-- Helper: workspace isolation policy (applied to all workspace-scoped tables)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'organizations', 'customers', 'groups', 'inboxes', 'ticket_forms',
      'brands', 'tickets', 'tags', 'custom_fields', 'rules',
      'automation_rules', 'sla_policies', 'views', 'kb_collections',
      'kb_articles', 'integrations', 'audit_events', 'sso_providers',
      'api_keys', 'conversations', 'messages', 'attachments', 'ticket_tags',
      'csat_ratings', 'time_entries', 'sla_events', 'kb_categories',
      'kb_revisions', 'external_objects', 'sync_cursors', 'import_jobs',
      'export_jobs', 'raw_records', 'custom_field_values',
      'audit_entries', 'gdpr_deletion_requests', 'retention_policies'
    ])
  LOOP
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (workspace_id = current_setting(''app.current_workspace_id'', true)::uuid)',
      tbl
    );
  END LOOP;
END
$$;

-- Tenant-level policies
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "workspaces"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "usage_metrics"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "billing_events"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
