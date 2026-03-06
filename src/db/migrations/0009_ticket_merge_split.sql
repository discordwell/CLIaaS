-- 0009: Ticket Merge & Split
-- Plan 10: merge duplicate tickets, split multi-issue tickets

-- Add merge/split tracking columns to tickets
ALTER TABLE tickets ADD COLUMN merged_into_ticket_id UUID REFERENCES tickets(id);
ALTER TABLE tickets ADD COLUMN split_from_ticket_id UUID REFERENCES tickets(id);

CREATE INDEX tickets_merged_into_idx ON tickets(merged_into_ticket_id) WHERE merged_into_ticket_id IS NOT NULL;
CREATE INDEX tickets_split_from_idx ON tickets(split_from_ticket_id) WHERE split_from_ticket_id IS NOT NULL;

-- Merge log: tracks every merge operation for undo support
CREATE TABLE ticket_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  primary_ticket_id UUID NOT NULL REFERENCES tickets(id),
  merged_ticket_id UUID NOT NULL REFERENCES tickets(id),
  merged_by UUID REFERENCES users(id),
  merged_ticket_snapshot JSONB NOT NULL,
  moved_message_ids UUID[] NOT NULL DEFAULT '{}',
  moved_attachment_ids UUID[] NOT NULL DEFAULT '{}',
  merged_tags TEXT[] NOT NULL DEFAULT '{}',
  undone BOOLEAN NOT NULL DEFAULT false,
  undone_at TIMESTAMPTZ,
  undone_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ticket_merge_log_workspace_idx ON ticket_merge_log(workspace_id);
CREATE INDEX ticket_merge_log_primary_idx ON ticket_merge_log(primary_ticket_id);
CREATE INDEX ticket_merge_log_merged_idx ON ticket_merge_log(merged_ticket_id);

-- Split log: tracks every split operation
CREATE TABLE ticket_split_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_ticket_id UUID NOT NULL REFERENCES tickets(id),
  new_ticket_id UUID NOT NULL REFERENCES tickets(id),
  split_by UUID REFERENCES users(id),
  moved_message_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ticket_split_log_workspace_idx ON ticket_split_log(workspace_id);
CREATE INDEX ticket_split_log_source_idx ON ticket_split_log(source_ticket_id);
CREATE INDEX ticket_split_log_new_idx ON ticket_split_log(new_ticket_id);

-- RLS policies
ALTER TABLE ticket_merge_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_split_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_merge_log_workspace_isolation ON ticket_merge_log
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY ticket_split_log_workspace_isolation ON ticket_split_log
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
