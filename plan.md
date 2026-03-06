# Slice 14: KB Enhancements — Task List

## Phase 1: Schema + Core i18n
- [x] 1.1 Migration 0014_kb_enhancements.sql
- [x] 1.2 Drizzle schema updates (schema.ts)
- [x] 1.3 DataProvider type updates (types.ts)
- [x] 1.4 DataProvider implementations (db, jsonl, remote, hybrid)
- [x] 1.5 API route updates (kb/route.ts, kb/[id]/route.ts)
- [x] 1.6 New API: kb/[id]/translations/route.ts
- [x] 1.7 RAG locale awareness (chunker.ts, retriever.ts)
- [x] 1.8 Tests for Phase 1 (14 tests passing)

## Phase 2: Brand Theming + Multi-Brand
- [x] 2.1 Brand type reconciliation (brands.ts)
- [x] 2.2 Brand API updates + new endpoints
- [x] 2.3 UI components (BrandThemeProvider, LocalePicker, TranslationStatusBadge)
- [x] 2.4 Portal layout updates
- [x] 2.5 Branded help center routes (/help/[brandSlug]/...)
- [x] 2.6 Subdomain routing (middleware.ts)
- [x] 2.7 Brand management pages
- [x] 2.8 Feature gate (multi_brand, answer_bot)
- [x] 2.9 CLI & MCP brand tools
- [x] 2.10 Portal KB scoping

## Phase 3: Answer Bot / KB Deflection
- [x] 3.1 Suggestion API (portal/kb/suggest)
- [x] 3.2 Deflection tracking API
- [x] 3.3 DeflectionPanel component
- [x] 3.4 New ticket form integration
- [x] 3.5 Chat article suggestions
- [x] 3.6 MCP & CLI deflection tools
- [x] 3.7 Tests for Phase 3

## Phase 4: Article Feedback + Content Gaps
- [x] 4.1 Feedback APIs (portal + agent-side)
- [x] 4.2 ArticleFeedback component
- [x] 4.3 Content gap analysis (lib + API)
- [x] 4.4 UI pages (content gaps, analytics)
- [x] 4.5 Portal feedback integration
- [x] 4.6 MCP & CLI feedback/gaps tools

## Phase 5: SEO + Language Detection + Polish
- [x] 5.1 Slug generation (lib/kb/slugs.ts)
- [x] 5.2 SEO-friendly article URLs
- [x] 5.3 Sitemap generation
- [x] 5.4 Language detection
- [x] 5.5 Auto-translate CLI
- [x] 5.6 KB management page polish
- [x] 5.7 New components (ArticleEditor, etc.)
- [x] 5.8 MCP tool updates
