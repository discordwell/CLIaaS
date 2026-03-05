-- Upstream outbox: queues changes to push back to source platforms
-- (Zendesk, Freshdesk, Groove, HelpCrunch, Intercom, HelpScout, Zoho Desk, HubSpot)

DO $$ BEGIN
  CREATE TYPE upstream_operation AS ENUM ('create_ticket', 'update_ticket', 'create_reply', 'create_note');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE upstream_status AS ENUM ('pending', 'pushed', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS upstream_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  connector       text NOT NULL,
  operation       upstream_operation NOT NULL,
  ticket_id       text NOT NULL,
  external_id     text,
  payload         jsonb NOT NULL,
  status          upstream_status NOT NULL DEFAULT 'pending',
  external_result jsonb,
  pushed_at       timestamptz,
  error           text,
  retry_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upstream_outbox_status_idx
  ON upstream_outbox (connector, status);

CREATE INDEX IF NOT EXISTS upstream_outbox_ticket_idx
  ON upstream_outbox (ticket_id);
