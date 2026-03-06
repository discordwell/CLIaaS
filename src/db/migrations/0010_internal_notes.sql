-- 0010_internal_notes.sql
-- Internal notes foundation: notifications table, mentions table, mentioned_user_ids on messages

-- Notification type enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('mention', 'side_conversation_reply', 'assignment', 'escalation');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add mentioned_user_ids to messages (Phase 2 prep)
DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN mentioned_user_ids uuid[];
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  type notification_type NOT NULL,
  title text NOT NULL,
  body text,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_workspace_idx
  ON notifications(workspace_id);

-- Mentions table
CREATE TABLE IF NOT EXISTS mentions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id),
  mentioned_user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid REFERENCES workspaces(id),
  read_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS mentions_message_idx ON mentions(message_id);
CREATE INDEX IF NOT EXISTS mentions_user_unread_idx
  ON mentions(mentioned_user_id, created_at DESC) WHERE read_at IS NULL;

-- RLS policies (if RLS is enabled on the workspace)
DO $$ BEGIN
  ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN others THEN NULL;
END $$;
