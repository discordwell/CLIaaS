-- Partial unique index for upstream outbox dedup.
-- Prevents duplicate pending create_ticket/update_ticket entries for the same
-- (workspace_id, connector, operation, ticket_id).
-- Excludes create_reply/create_note since multiple distinct replies are valid.
-- Application-level dedup in enqueueUpstream() handles merges/skips gracefully;
-- this index is a DB-level safety net for race conditions.

CREATE UNIQUE INDEX IF NOT EXISTS upstream_outbox_dedup_idx
  ON upstream_outbox (workspace_id, connector, operation, ticket_id)
  WHERE status = 'pending' AND operation IN ('create_ticket', 'update_ticket');
