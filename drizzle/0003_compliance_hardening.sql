-- Migration 0003: Compliance Hardening (Week 5, Phases 1-2)
-- Adds workspace_id to audit_entries, creates GDPR and retention tables.

-- Phase 1: Add workspace_id to audit_entries (nullable for backcompat)
ALTER TABLE "audit_entries" ADD COLUMN "workspace_id" uuid REFERENCES "workspaces"("id");
CREATE INDEX "audit_entries_workspace_idx" ON "audit_entries" ("workspace_id", "timestamp");

-- Phase 2: GDPR deletion requests
CREATE TABLE IF NOT EXISTS "gdpr_deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "subject_email" varchar(320) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "records_affected" jsonb,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE INDEX "gdpr_deletion_workspace_idx" ON "gdpr_deletion_requests" ("workspace_id", "requested_at");

-- Phase 2: Retention policies
CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "resource" text NOT NULL,
  "retention_days" integer NOT NULL,
  "action" text NOT NULL DEFAULT 'delete',
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "retention_policies_ws_resource" ON "retention_policies" ("workspace_id", "resource");
