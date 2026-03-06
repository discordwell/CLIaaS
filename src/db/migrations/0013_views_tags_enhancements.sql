-- Slice 11: Views & Tags enhancements

-- Tags enhancements
ALTER TABLE tags ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#71717a';
ALTER TABLE tags ADD COLUMN IF NOT EXISTS description TEXT;

-- Views enhancements
ALTER TABLE views ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE views ADD COLUMN IF NOT EXISTS view_type TEXT NOT NULL DEFAULT 'shared'
  CHECK (view_type IN ('system', 'shared', 'personal'));
ALTER TABLE views ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE views ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE views ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS views_workspace_type_idx ON views(workspace_id, view_type);
