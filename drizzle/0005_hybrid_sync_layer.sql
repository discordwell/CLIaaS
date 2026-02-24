-- Migration 0005: Hybrid Sync Layer (Phase 5)
-- Creates sync_outbox and sync_conflicts tables for hybrid tier sync.

-- ============================================================================
-- Step 1: Create enum types
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "sync_outbox_operation" AS ENUM ('create', 'update');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "sync_outbox_entity_type" AS ENUM ('ticket', 'message', 'kb_article');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "sync_outbox_status" AS ENUM ('pending_push', 'pushed', 'conflict', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Step 2: Create sync_outbox table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sync_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "operation" "sync_outbox_operation" NOT NULL,
  "entity_type" "sync_outbox_entity_type" NOT NULL,
  "entity_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "sync_outbox_status" NOT NULL DEFAULT 'pending_push',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pushed_at" timestamp with time zone,
  "error" text
);

CREATE INDEX IF NOT EXISTS "sync_outbox_status_idx"
  ON "sync_outbox" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "sync_outbox_entity_idx"
  ON "sync_outbox" ("entity_type", "entity_id");

-- ============================================================================
-- Step 3: Create sync_conflicts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "sync_conflicts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "entity_type" "sync_outbox_entity_type" NOT NULL,
  "entity_id" text NOT NULL,
  "local_version" jsonb NOT NULL,
  "hosted_version" jsonb NOT NULL,
  "local_updated_at" timestamp with time zone NOT NULL,
  "hosted_updated_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sync_conflicts_unresolved_idx"
  ON "sync_conflicts" ("workspace_id", "resolved_at");
CREATE INDEX IF NOT EXISTS "sync_conflicts_entity_idx"
  ON "sync_conflicts" ("entity_type", "entity_id");
