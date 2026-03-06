-- Slice 14: KB Enhancements — multilingual, brands, feedback, deflection, SEO

-- Visibility enum for KB articles
DO $$ BEGIN
  CREATE TYPE kb_visibility AS ENUM ('public', 'internal', 'draft');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Content gap status enum
DO $$ BEGIN
  CREATE TYPE kb_gap_status AS ENUM ('open', 'accepted', 'dismissed', 'created');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- ALTER brands ----
ALTER TABLE brands ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS favicon_url TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#000000';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) DEFAULT '#3b82f6';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS header_html TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS footer_html TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS custom_css TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS help_center_enabled BOOLEAN DEFAULT false;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS help_center_title TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS default_locale VARCHAR(10) DEFAULT 'en';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS supported_locales TEXT[] DEFAULT ARRAY['en'];

CREATE UNIQUE INDEX IF NOT EXISTS brands_subdomain_idx ON brands(subdomain) WHERE subdomain IS NOT NULL;

-- ---- ALTER kb_articles ----
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS parent_article_id UUID REFERENCES kb_articles(id);
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) DEFAULT 'public';
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS seo_keywords TEXT[];
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS helpful_count INTEGER DEFAULT 0;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER DEFAULT 0;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS kb_articles_locale_idx ON kb_articles(locale);
CREATE INDEX IF NOT EXISTS kb_articles_parent_idx ON kb_articles(parent_article_id);
CREATE INDEX IF NOT EXISTS kb_articles_brand_idx ON kb_articles(brand_id);
CREATE INDEX IF NOT EXISTS kb_articles_slug_idx ON kb_articles(workspace_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS kb_articles_translation_unique_idx
  ON kb_articles(parent_article_id, locale) WHERE parent_article_id IS NOT NULL;

-- ---- ALTER kb_categories ----
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS slug VARCHAR(255);
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS icon TEXT;

-- ---- ALTER kb_collections ----
ALTER TABLE kb_collections ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);
ALTER TABLE kb_collections ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE kb_collections ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';

-- ---- ALTER rag_chunks ----
ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'en';
CREATE INDEX IF NOT EXISTS rag_chunks_locale_idx ON rag_chunks(locale);

-- ---- CREATE kb_article_feedback ----
CREATE TABLE IF NOT EXISTS kb_article_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  article_id UUID NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  session_id TEXT,
  customer_id UUID REFERENCES customers(id),
  helpful BOOLEAN NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_article_feedback_article_idx ON kb_article_feedback(article_id);
CREATE INDEX IF NOT EXISTS kb_article_feedback_workspace_idx ON kb_article_feedback(workspace_id);

-- ---- CREATE kb_deflections ----
CREATE TABLE IF NOT EXISTS kb_deflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  article_id UUID REFERENCES kb_articles(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES brands(id),
  source VARCHAR(20) NOT NULL DEFAULT 'portal',
  query TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  session_id TEXT,
  deflected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_deflections_workspace_idx ON kb_deflections(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS kb_deflections_article_idx ON kb_deflections(article_id);

-- ---- CREATE kb_content_gaps ----
CREATE TABLE IF NOT EXISTS kb_content_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  topic TEXT NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  sample_ticket_ids TEXT[],
  suggested_title TEXT,
  suggested_outline TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_article_id UUID REFERENCES kb_articles(id),
  brand_id UUID REFERENCES brands(id),
  locale VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_content_gaps_workspace_idx ON kb_content_gaps(workspace_id, status);

-- ---- Backfill existing data ----
UPDATE kb_articles SET locale = 'en' WHERE locale IS NULL;
UPDATE kb_articles SET visibility = 'public' WHERE visibility IS NULL;
UPDATE rag_chunks SET locale = 'en' WHERE locale IS NULL;
