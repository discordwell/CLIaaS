-- 0011_side_conversations.sql
-- Side conversations: multiple conversation threads per ticket

-- Conversation kind enum
DO $$ BEGIN
  CREATE TYPE conversation_kind AS ENUM ('primary', 'side');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Side conversation status enum
DO $$ BEGIN
  CREATE TYPE side_conversation_status AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to conversations
DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN kind conversation_kind NOT NULL DEFAULT 'primary';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN subject text;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN external_email varchar(320);
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN created_by_id uuid REFERENCES users(id);
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN status side_conversation_status NOT NULL DEFAULT 'open';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Drop the existing unique index on (ticket_id) and replace with a regular index
-- The unique constraint prevents multiple conversations per ticket
DROP INDEX IF EXISTS conversations_ticket_idx;
CREATE INDEX IF NOT EXISTS conversations_ticket_idx ON conversations(ticket_id);

-- Add a conditional unique index: only one primary conversation per ticket
CREATE UNIQUE INDEX IF NOT EXISTS conversations_primary_ticket_idx
  ON conversations(ticket_id) WHERE kind = 'primary';

-- Index for listing side conversations
CREATE INDEX IF NOT EXISTS conversations_kind_idx ON conversations(ticket_id, kind);
