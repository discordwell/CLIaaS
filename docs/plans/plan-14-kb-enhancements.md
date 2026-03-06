# Plan 14: Multilingual KB, Branded Help Centers, Multi-Brand, Answer Bot / KB Deflection

## 1. What Exists Today

### Database Schema (`src/db/schema.ts`)

| Table | Lines | Key Columns | Notes |
|-------|-------|-------------|-------|
| `kb_collections` | 519-524 | `id`, `workspaceId`, `name` | Top-level grouping; no brand or locale |
| `kb_categories` | 526-539 | `id`, `collectionId`, `workspaceId`, `name`, `parentId` | Nested categories via `parentId` |
| `kb_articles` | 541-553 | `id`, `workspaceId`, `collectionId`, `categoryId`, `categoryPath[]`, `title`, `body`, `status`, `authorId`, `source` | No `locale`, no `parentArticleId`, no `brandId`, no SEO fields, no `visibility` (internal vs public) |
| `kb_revisions` | 555-567 | `id`, `articleId`, `workspaceId`, `body` | Revision tracking; no `authorId` on revision |
| `brands` | 268-283 | `id`, `workspaceId`, `name`, `raw` | Exists but minimal -- no subdomain, logo, colors, help center config |
| `rag_chunks` | 809-838 | vector(1536), hybrid search | Used for semantic KB search; no locale-aware indexing |
| `tickets` | (line 296) | `brandId` FK to brands | Tickets already have brand association |

### API Routes

| Route | File | Methods | Notes |
|-------|------|---------|-------|
| `/api/kb` | `src/app/api/kb/route.ts` | GET, POST | Lists/creates articles. GET supports `q`, `category`, `status` filters. DB-aware with JSONL fallback. Auth-scoped. |
| `/api/kb/[id]` | `src/app/api/kb/[id]/route.ts` | GET, PATCH, DELETE | Single article CRUD. Workspace-scoped. |
| `/api/portal/kb` | `src/app/api/portal/kb/route.ts` | GET | Public-facing article list. No auth required. Supports `q` and `category` filters. No locale filter. |

### UI Pages

| Page | File | Notes |
|------|------|-------|
| `/kb` | `src/app/kb/page.tsx` | Agent-facing KB management. Groups by category. No article creation/editing UI -- just read-only list. |
| `/portal/kb` | `src/app/portal/kb/page.tsx` | Customer-facing KB. Search + category filters + expand/collapse articles. No locale picker. |
| `/portal/tickets/new` | `src/app/portal/tickets/new/page.tsx` | Ticket submission form. No article suggestion/deflection before submit. |
| `/portal` | `src/app/portal/page.tsx` | Portal landing. Links to KB and new ticket. |
| Portal layout | `src/app/portal/layout.tsx` | Hardcoded "CLIaaS Support Portal" branding. No per-brand theming. |

### CLI Commands

| Command | File | Notes |
|---------|------|-------|
| `cliaas kb suggest --ticket <id>` | `cli/commands/kb.ts` | Suggests articles for a ticket via LLM or RAG. No locale awareness. |

### MCP Tools

| Tool | File | Notes |
|------|------|-------|
| `kb_search` | `cli/mcp/tools/kb.ts:6-42` | Text-matching search across articles. No locale filter. |
| `kb_suggest` | `cli/mcp/tools/kb.ts:44-99` | LLM or RAG-based article suggestions for a ticket. No locale filter. |

### RAG System

| File | Notes |
|------|-------|
| `cli/rag/chunker.ts` | `chunkKBArticle()` at line 58 -- prepends `[KB Article: title]` prefix. No locale in prefix. |
| `cli/rag/retriever.ts` | Hybrid vector+full-text retrieval with RRF. Filters by `sourceType` but not locale. |
| `cli/rag/types.ts` | `RagChunk.metadata` is `Record<string, unknown>` -- could store locale here. |

### Chat Widget

| File | Notes |
|------|-------|
| `src/components/ChatWidget.tsx` | Full live chat widget with pre-chat form, messaging, typing indicators, bot buttons. No KB article suggestion during chat. |

### Feature Gates

| File | Notes |
|------|-------|
| `src/lib/features/gates.ts` | `custom_branding` feature exists (line 30), enabled for all tiers. No `multilingual_kb`, `answer_bot`, or `multi_brand` features. |

### Data Provider

| File | Notes |
|------|-------|
| `src/lib/data-provider/types.ts` | `KBArticle` interface (lines 46-55): `id`, `externalId`, `source`, `title`, `body`, `categoryPath[]`, `status`, `updatedAt`. No `locale`, `brandId`, `parentArticleId`, `visibility`, or SEO fields. |

---

## 2. Proposed DB Schema Changes

### 2.1 Modify `brands` Table (add help center config)

```sql
ALTER TABLE brands
  ADD COLUMN subdomain varchar(63),
  ADD COLUMN logo_url text,
  ADD COLUMN favicon_url text,
  ADD COLUMN primary_color varchar(7) DEFAULT '#000000',
  ADD COLUMN accent_color varchar(7) DEFAULT '#3b82f6',
  ADD COLUMN header_html text,
  ADD COLUMN footer_html text,
  ADD COLUMN custom_css text,
  ADD COLUMN help_center_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN help_center_title text,
  ADD COLUMN default_locale varchar(10) DEFAULT 'en',
  ADD COLUMN supported_locales text[] DEFAULT ARRAY['en'],
  ADD COLUMN meta_description text,
  ADD COLUMN custom_head_html text;

CREATE UNIQUE INDEX brands_subdomain_idx ON brands(subdomain) WHERE subdomain IS NOT NULL;
```

### 2.2 Modify `kb_articles` Table (add i18n + brand + SEO + visibility)

```sql
ALTER TABLE kb_articles
  ADD COLUMN locale varchar(10) NOT NULL DEFAULT 'en',
  ADD COLUMN parent_article_id uuid REFERENCES kb_articles(id),
  ADD COLUMN brand_id uuid REFERENCES brands(id),
  ADD COLUMN visibility varchar(10) NOT NULL DEFAULT 'public',
  ADD COLUMN slug varchar(255),
  ADD COLUMN meta_title text,
  ADD COLUMN meta_description text,
  ADD COLUMN canonical_url text,
  ADD COLUMN seo_keywords text[],
  ADD COLUMN position integer DEFAULT 0,
  ADD COLUMN helpful_count integer NOT NULL DEFAULT 0,
  ADD COLUMN not_helpful_count integer NOT NULL DEFAULT 0,
  ADD COLUMN view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX kb_articles_locale_idx ON kb_articles(workspace_id, locale);
CREATE INDEX kb_articles_parent_idx ON kb_articles(parent_article_id);
CREATE INDEX kb_articles_brand_idx ON kb_articles(brand_id);
CREATE INDEX kb_articles_slug_idx ON kb_articles(workspace_id, slug);
CREATE UNIQUE INDEX kb_articles_parent_locale_idx ON kb_articles(parent_article_id, locale)
  WHERE parent_article_id IS NOT NULL;
```

**`visibility` enum values:** `public` (customer-facing), `internal` (agent-only), `draft`.

### 2.3 Modify `kb_categories` Table (add i18n + brand)

```sql
ALTER TABLE kb_categories
  ADD COLUMN locale varchar(10) NOT NULL DEFAULT 'en',
  ADD COLUMN parent_category_translation_id uuid,
  ADD COLUMN brand_id uuid REFERENCES brands(id),
  ADD COLUMN slug varchar(255),
  ADD COLUMN description text,
  ADD COLUMN position integer DEFAULT 0,
  ADD COLUMN icon varchar(50);
```

### 2.4 Modify `kb_collections` Table (add brand)

```sql
ALTER TABLE kb_collections
  ADD COLUMN brand_id uuid REFERENCES brands(id),
  ADD COLUMN description text,
  ADD COLUMN locale varchar(10) NOT NULL DEFAULT 'en';
```

### 2.5 New Table: `kb_article_feedback`

```sql
CREATE TABLE kb_article_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  article_id uuid NOT NULL REFERENCES kb_articles(id),
  session_id varchar(64),
  customer_id uuid REFERENCES customers(id),
  helpful boolean NOT NULL,
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX kb_article_feedback_article_idx ON kb_article_feedback(article_id);
CREATE INDEX kb_article_feedback_workspace_idx ON kb_article_feedback(workspace_id);
```

### 2.6 New Table: `kb_deflections`

Tracks when an article suggestion prevented a ticket from being created.

```sql
CREATE TABLE kb_deflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  article_id uuid NOT NULL REFERENCES kb_articles(id),
  brand_id uuid REFERENCES brands(id),
  source varchar(20) NOT NULL, -- 'portal', 'chat', 'sdk', 'email'
  query text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  session_id varchar(64),
  deflected boolean NOT NULL DEFAULT false, -- true if user did NOT submit a ticket after viewing
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX kb_deflections_workspace_idx ON kb_deflections(workspace_id, created_at);
CREATE INDEX kb_deflections_article_idx ON kb_deflections(article_id);
```

### 2.7 New Table: `kb_content_gaps`

AI-identified gaps in KB coverage based on unresolved ticket topics.

```sql
CREATE TABLE kb_content_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  topic text NOT NULL,
  ticket_count integer NOT NULL DEFAULT 1,
  sample_ticket_ids text[] DEFAULT ARRAY[]::text[],
  suggested_title text,
  suggested_outline text,
  status varchar(20) NOT NULL DEFAULT 'open', -- 'open', 'accepted', 'dismissed', 'article_created'
  created_article_id uuid REFERENCES kb_articles(id),
  brand_id uuid REFERENCES brands(id),
  locale varchar(10) DEFAULT 'en',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX kb_content_gaps_workspace_idx ON kb_content_gaps(workspace_id, status);
```

### 2.8 Modify `rag_chunks` Table (add locale)

```sql
ALTER TABLE rag_chunks
  ADD COLUMN locale varchar(10) DEFAULT 'en';

CREATE INDEX rag_chunks_locale_idx ON rag_chunks(workspace_id, locale);
```

### Schema Summary

| Change | Type | Tables |
|--------|------|--------|
| Add help center config | ALTER | `brands` |
| Add i18n + brand + SEO + visibility | ALTER | `kb_articles` |
| Add i18n + brand | ALTER | `kb_categories`, `kb_collections` |
| Add locale | ALTER | `rag_chunks` |
| Article feedback | NEW | `kb_article_feedback` |
| Deflection tracking | NEW | `kb_deflections` |
| Content gap analysis | NEW | `kb_content_gaps` |

**New table count: 3. Modified tables: 5. Total new columns: ~35.**

---

## 3. New API Routes

### 3.1 Multilingual KB Articles

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/kb` | Modify | Add `locale`, `brandId`, `visibility` query params |
| `POST /api/kb` | Modify | Accept `locale`, `parentArticleId`, `brandId`, `visibility`, `slug`, SEO fields |
| `PATCH /api/kb/[id]` | Modify | Accept all new fields |
| `GET /api/kb/[id]/translations` | New | List all translations of an article (query by `parentArticleId`) |
| `POST /api/kb/[id]/translations` | New | Create a translation of an article (sets `parentArticleId` + `locale`) |

### 3.2 Help Center / Brand Theming

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/brands` | New | List brands with help center config |
| `GET /api/brands/[id]` | New | Get brand detail + theme |
| `PATCH /api/brands/[id]` | New | Update brand theme (logo, colors, CSS, locale config) |
| `GET /api/brands/[id]/preview` | New | Preview help center theme (returns rendered HTML snippet) |

### 3.3 Public Help Center (brand-scoped portal)

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/portal/kb` | Modify | Add `locale`, `brandId` params. Only return `visibility=public` articles. |
| `GET /api/portal/kb/[slug]` | New | Get article by slug (SEO-friendly). Increments `view_count`. |
| `GET /api/portal/kb/sitemap` | New | Generate sitemap XML for all published articles |
| `GET /api/portal/brands/[id]/theme` | New | Get brand theme CSS/config for client-side rendering |

### 3.4 Answer Bot / KB Deflection

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/portal/kb/suggest` | New | Given a query string (subject/description), return top-N matching articles via RAG. Used by pre-ticket-submission deflection UI. |
| `POST /api/portal/kb/deflection` | New | Record a deflection event (article shown, user did/did not submit ticket) |
| `POST /api/chat/suggest-articles` | New | During live chat, given latest messages, return relevant KB articles. Used by chat widget and agent-side panel. |

### 3.5 Article Feedback

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/portal/kb/[id]/feedback` | New | Submit helpful/not-helpful vote + optional comment |
| `GET /api/kb/[id]/feedback` | New | Agent-side: get feedback summary for an article |
| `GET /api/kb/feedback/analytics` | New | Aggregate feedback analytics (top helpful, top unhelpful, trends) |

### 3.6 Content Cues / Gap Analysis

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/kb/content-gaps/analyze` | New | Trigger AI analysis of recent unresolved tickets to identify KB gaps |
| `GET /api/kb/content-gaps` | New | List identified gaps |
| `PATCH /api/kb/content-gaps/[id]` | New | Accept/dismiss a gap; link to created article |

### 3.7 Language Detection

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/portal/detect-locale` | New | Detect locale from `Accept-Language` header, return best match from brand's `supported_locales` |

**Total: ~20 new/modified API routes.**

---

## 4. New/Modified UI Pages & Components

### 4.1 Modified Pages

#### `/kb` (Agent KB Management) -- `src/app/kb/page.tsx`
- Add locale switcher dropdown (tabs or select)
- Add brand filter dropdown
- Add visibility filter (public / internal / draft)
- Add article creation/editing modal or side panel
- Add translation status indicators (e.g., "3/5 languages translated")
- Add SEO fields section in article editor (slug, meta title, meta description)
- Add feedback summary per article (helpful %, total votes)
- Add "Content Gaps" tab showing AI-identified topics

#### `/portal/kb` (Customer KB) -- `src/app/portal/kb/page.tsx`
- Add locale picker in header (based on brand's `supported_locales`)
- Filter articles by selected locale
- Show articles by slug-based URLs
- Add helpful/not-helpful feedback buttons on expanded articles
- Apply brand theming (colors, logo, custom CSS)

#### `/portal/tickets/new` (New Ticket Form) -- `src/app/portal/tickets/new/page.tsx`
- Add **answer bot deflection**: as user types subject/description, debounce-fetch suggested articles from `/api/portal/kb/suggest`
- Show suggested articles panel before submit button
- Track deflection events (user saw articles and chose not to submit)

#### Portal Layout -- `src/app/portal/layout.tsx`
- Accept brand context (from URL subdomain or query param)
- Apply brand theming (logo, colors, CSS, title)
- Show locale switcher in nav

#### Chat Widget -- `src/components/ChatWidget.tsx`
- During chat, after customer sends a message, auto-fetch relevant KB articles from `/api/chat/suggest-articles`
- Show article cards inline as bot messages with "Was this helpful?" buttons
- Track deflections when user clicks article and does not continue chat

### 4.2 New Pages

| Page | Purpose |
|------|---------|
| `/kb/articles/[id]` | Full article editor with WYSIWYG, SEO fields, translation management, feedback view |
| `/kb/content-gaps` | Content gap dashboard -- list gaps, accept/dismiss, create article from gap |
| `/kb/analytics` | KB analytics: view counts, feedback trends, deflection rates, top articles, content coverage |
| `/brands` | Brand management page (list brands, configure help center per brand) |
| `/brands/[id]` | Brand detail: theme editor (logo, colors, CSS), help center settings, locale config |
| `/portal/kb/[slug]` | SEO-friendly article detail page (public) |
| `/help/[brandSlug]` | Brand-scoped help center entry point (alternative to subdomain routing) |
| `/help/[brandSlug]/[locale]` | Locale-scoped help center |
| `/help/[brandSlug]/[locale]/[categorySlug]` | Category view within branded help center |
| `/help/[brandSlug]/[locale]/articles/[articleSlug]` | Article detail within branded help center |

### 4.3 New Components

| Component | Purpose |
|-----------|---------|
| `LocalePicker` | Dropdown to switch locale; reads `supported_locales` from brand config |
| `ArticleEditor` | Rich text editor for article body + SEO fields + translation status |
| `ArticleFeedback` | Helpful/Not helpful buttons + optional comment form |
| `DeflectionPanel` | Shows suggested KB articles during ticket creation; used in portal and SDK |
| `BrandThemeProvider` | Context provider that loads brand CSS/colors and applies them to portal |
| `ContentGapCard` | Card showing a content gap with sample tickets and actions |
| `TranslationStatusBadge` | Shows translation coverage (e.g., "3/5 locales") |
| `KBAnalyticsChart` | Charts for view counts, deflection rates, feedback trends |
| `ArticleSuggestionCard` | Compact card for displaying a suggested article (used in chat + deflection) |

---

## 5. New CLI Commands

| Command | Description |
|---------|-------------|
| `cliaas kb list [--locale <locale>] [--brand <brand>] [--visibility <vis>]` | List articles with locale/brand/visibility filters |
| `cliaas kb translate --article <id> --locale <locale> [--auto]` | Create a translation of an article. `--auto` uses LLM to auto-translate. |
| `cliaas kb translate-status [--brand <brand>]` | Show translation coverage report (articles x locales matrix) |
| `cliaas kb feedback --article <id>` | Show feedback summary for an article |
| `cliaas kb content-gaps [--analyze]` | List content gaps. `--analyze` triggers fresh AI analysis. |
| `cliaas kb deflection-stats [--days <n>]` | Show deflection statistics (total suggestions, deflection rate, top articles) |
| `cliaas kb seo-audit [--brand <brand>]` | Check all articles for missing SEO fields (slug, meta title, meta description) |
| `cliaas kb export-sitemap --brand <brand> [--out <file>]` | Generate sitemap XML for a brand's help center |
| `cliaas brands list` | List brands with help center status |
| `cliaas brands configure --brand <id> [--logo <url>] [--colors <primary,accent>] [--locales <en,fr,de>]` | Configure brand help center |

---

## 6. New MCP Tools

| Tool | Description |
|------|-------------|
| `kb_search` (modify) | Add `locale`, `brandId`, `visibility` params |
| `kb_suggest` (modify) | Add `locale` param; filter results by locale |
| `kb_translate` | Create or update a translation of an article. Params: `articleId`, `targetLocale`, `title`, `body` (or `autoTranslate: true`) |
| `kb_translations` | List all translations for an article |
| `kb_feedback_summary` | Get feedback analytics for an article or across the KB |
| `kb_content_gaps` | List content gaps; optionally trigger analysis |
| `kb_deflection_stats` | Get deflection statistics |
| `kb_article_create` (modify existing `createKBArticle` path) | Add `locale`, `brandId`, `visibility`, `slug`, SEO fields |
| `brand_list` | List brands with help center config |
| `brand_configure` | Update brand help center settings |
| `kb_suggest_for_query` | Given a free-text query (not a ticket ID), return matching articles. Used by answer bot. |

**Total: 7 new tools + 4 modified tools.**

---

## 7. Migration / Rollout Plan

### Phase 1: Schema + Core i18n (Week 1-2) -- Effort: L

1. **Migration `0007_kb_enhancements.sql`**: All schema changes from Section 2.
2. **Update Drizzle schema** (`src/db/schema.ts`): Add all new columns to existing table definitions; add 3 new tables.
3. **Update `DataProvider` interface** (`src/lib/data-provider/types.ts`):
   - Extend `KBArticle` with `locale`, `parentArticleId`, `brandId`, `visibility`, `slug`, SEO fields, counters.
   - Add `KBArticleCreateParams` locale/brand/visibility fields.
   - Add new methods: `loadKBArticleTranslations()`, `createKBArticleFeedback()`, `loadKBArticleFeedback()`.
4. **Update all 4 DataProvider implementations** (db, jsonl, remote, hybrid) to handle new fields.
5. **Update API routes** `/api/kb` and `/api/kb/[id]` to accept and return new fields.
6. **Update portal KB API** to filter by `locale` and `visibility=public`.
7. **Add `GET /api/kb/[id]/translations`** and `POST /api/kb/[id]/translations`**.
8. **Update RAG chunker** to include locale in chunk metadata/prefix.
9. **Update RAG retriever** to accept optional `locale` filter.
10. **Backfill existing articles**: Set `locale='en'`, `visibility='public'`, generate slugs from titles.

### Phase 2: Brand Theming + Multi-Brand (Week 2-3) -- Effort: M

1. **Extend `brands` table** with help center columns.
2. **Add brand API routes**: `/api/brands`, `/api/brands/[id]`.
3. **Create `BrandThemeProvider`** component.
4. **Update portal layout** to accept brand context and apply theming.
5. **Create `/brands` management page** and `/brands/[id]` theme editor.
6. **Create `/help/[brandSlug]` route tree** for brand-scoped help centers.
7. **Add `brands list` and `brands configure` CLI commands**.
8. **Add `brand_list` and `brand_configure` MCP tools**.
9. **Add `multi_brand` feature gate** (enterprise + byoc only).
10. **Update portal KB** to scope articles by brand when brand context is present.

### Phase 3: Answer Bot / KB Deflection (Week 3-4) -- Effort: L

1. **Create `/api/portal/kb/suggest`** endpoint (RAG-powered article suggestion from free text).
2. **Create `DeflectionPanel` component**.
3. **Integrate into `/portal/tickets/new`**: debounce subject/description changes, show suggestions before submit.
4. **Create `/api/portal/kb/deflection`** tracking endpoint.
5. **Create `kb_deflections` table** and tracking logic.
6. **Integrate into ChatWidget**: after customer message, fetch and display relevant articles.
7. **Create `/api/chat/suggest-articles`** endpoint.
8. **Add `kb_suggest_for_query` MCP tool**.
9. **Add `kb deflection-stats` CLI command**.
10. **Add `answer_bot` feature gate** (pro + enterprise + byoc).

### Phase 4: Article Feedback + Content Cues (Week 4-5) -- Effort: M

1. **Create `kb_article_feedback` table**.
2. **Create feedback API routes**: `POST /api/portal/kb/[id]/feedback`, `GET /api/kb/[id]/feedback`.
3. **Create `ArticleFeedback` component** (customer-facing).
4. **Integrate into portal KB article view** and branded help center.
5. **Update `kb_articles` helpful/not-helpful counters** via trigger or application-side increment.
6. **Create content gap analysis logic** (`src/lib/kb/content-gaps.ts`):
   - Analyze unresolved tickets from last N days.
   - Cluster by topic (LLM-based).
   - Compare against existing KB coverage.
   - Generate gap records with suggested titles/outlines.
7. **Create `kb_content_gaps` table** and API routes.
8. **Create `/kb/content-gaps` page**.
9. **Add `kb content-gaps` CLI command** and `kb_content_gaps` MCP tool.
10. **Create `/kb/analytics` page** with view counts, feedback trends, deflection rates.

### Phase 5: SEO + Language Detection + Polish (Week 5-6) -- Effort: M

1. **Implement slug generation** (auto-generate from title, ensure uniqueness per workspace).
2. **Create `/api/portal/kb/sitemap` endpoint** (XML sitemap).
3. **Create `/portal/kb/[slug]` page** (SEO-friendly article URLs).
4. **Add `<head>` meta tags** (title, description, canonical, hreflang alternates for translations).
5. **Implement `Accept-Language` detection** in portal middleware or `/api/portal/detect-locale`.
6. **Auto-redirect portal users** to their preferred locale if brand supports it.
7. **Add `kb seo-audit` CLI command**.
8. **Add `kb export-sitemap` CLI command**.
9. **Auto-translate CLI**: `cliaas kb translate --auto` uses LLM provider to translate article content.
10. **Update KB management page** with translation status badges, SEO field indicators.

### Rollout Sequence

```
Week 1-2: Phase 1 (Schema + Core i18n)
  |-- Migration, DataProvider updates, API changes
  |-- RAG locale awareness

Week 2-3: Phase 2 (Brand Theming)
  |-- Brand config, theme provider, branded portals
  |-- Feature gates

Week 3-4: Phase 3 (Answer Bot)
  |-- Deflection in ticket form
  |-- Chat article suggestions
  |-- Deflection tracking

Week 4-5: Phase 4 (Feedback + Content Cues)
  |-- Feedback system
  |-- AI gap analysis
  |-- Analytics page

Week 5-6: Phase 5 (SEO + Polish)
  |-- Slug URLs, sitemaps, meta tags
  |-- Language detection, auto-translate
  |-- Final polish and testing
```

### Data Migration Notes

- **Existing articles** get `locale='en'`, `visibility='public'`, `parent_article_id=NULL` (they are the canonical/parent).
- **Existing brands** get `help_center_enabled=false`, `default_locale='en'`, `supported_locales=['en']`.
- **Existing rag_chunks** get `locale='en'`.
- **Slug generation**: `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')` with dedup suffix.
- **No breaking changes**: All new columns have defaults. Existing API responses gain new fields but no fields are removed.

---

## 8. Effort Estimate

| Phase | Scope | Effort | Files Touched |
|-------|-------|--------|---------------|
| Phase 1: Schema + i18n | Migration, 5 schema defs, 4 providers, 3 API routes, RAG updates | **L** | ~20 files |
| Phase 2: Brand Theming | Brand API, theme provider, 3 new pages, portal layout, feature gates | **M** | ~15 files |
| Phase 3: Answer Bot | Deflection API, DeflectionPanel, chat integration, tracking | **L** | ~12 files |
| Phase 4: Feedback + Content Cues | Feedback system, AI gap analysis, analytics page | **M** | ~15 files |
| Phase 5: SEO + Polish | Slugs, sitemaps, meta tags, language detection, auto-translate | **M** | ~12 files |

**Overall: XL (5-6 weeks)**

### Estimated Artifact Counts

| Category | Count |
|----------|-------|
| New DB tables | 3 |
| Modified DB tables | 5 |
| New columns | ~35 |
| New API routes | ~15 |
| Modified API routes | ~5 |
| New UI pages | ~8 |
| Modified UI pages | ~5 |
| New components | ~9 |
| New CLI commands | ~10 |
| New MCP tools | ~7 |
| Modified MCP tools | ~4 |
| New tests (estimated) | ~25 files |
| Migration files | 1 |

### Dependencies

- LLM provider required for: auto-translate, content gap analysis, answer bot suggestions (RAG embedding).
- RAG database required for: answer bot deflection, in-chat suggestions, content gap analysis.
- No new external service dependencies (no third-party translation API required -- uses existing LLM providers).

### Risk Areas

1. **RAG locale filtering**: Need to ensure locale-filtered retrieval doesn't degrade search quality for low-content locales. Fallback: if locale-specific results are insufficient, also return default-locale results with a locale mismatch indicator.
2. **Brand subdomain routing**: Next.js middleware needs to detect subdomain and resolve to brand. Alternative: path-based routing (`/help/[brandSlug]`) avoids DNS complexity.
3. **Slug uniqueness**: Must be unique per workspace (not globally). Race condition on concurrent slug creation -- use DB unique index + retry with suffix.
4. **Content gap analysis cost**: LLM calls to cluster tickets can be expensive. Rate-limit to manual trigger or daily cron, not real-time.
5. **Translation drift**: When a parent article is updated, translations may become stale. Track `parent_updated_at` vs `translation_updated_at` and surface "needs update" status.
