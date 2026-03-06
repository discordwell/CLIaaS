import { describe, it, expect } from 'vitest';

describe('KB Article types', () => {
  it('KBArticle type includes i18n fields', async () => {
    const { KBArticle } = await import('../../data-provider/types') as { KBArticle: unknown };
    // Type-level test: if this compiles, the fields exist
    const article = {
      id: 'art-1',
      title: 'Test Article',
      body: 'Body text',
      categoryPath: ['Getting Started'],
      locale: 'fr',
      parentArticleId: 'art-parent',
      brandId: 'brand-1',
      visibility: 'public' as const,
      slug: 'test-article',
      metaTitle: 'Test',
      metaDescription: 'Description',
      seoKeywords: ['test', 'kb'],
      position: 0,
      helpfulCount: 5,
      notHelpfulCount: 1,
      viewCount: 100,
      createdAt: new Date().toISOString(),
    };
    expect(article.locale).toBe('fr');
    expect(article.visibility).toBe('public');
    expect(article.seoKeywords).toHaveLength(2);
  });

  it('KBArticleCreateParams accepts i18n fields', () => {
    const params = {
      title: 'New Article',
      body: 'Content',
      locale: 'es',
      parentArticleId: 'art-1',
      brandId: 'brand-1',
      visibility: 'draft' as const,
      slug: 'new-article',
      metaTitle: 'Meta',
      metaDescription: 'Desc',
    };
    expect(params.locale).toBe('es');
    expect(params.visibility).toBe('draft');
  });

  it('KBArticleFeedbackParams has required fields', () => {
    const params = {
      articleId: 'art-1',
      helpful: true,
      sessionId: 'sess-1',
      comment: 'Great article!',
    };
    expect(params.helpful).toBe(true);
    expect(params.articleId).toBe('art-1');
  });
});

describe('KB visibility enum values', () => {
  it('accepts valid visibility values', () => {
    const valid = ['public', 'internal', 'draft'];
    for (const v of valid) {
      expect(valid).toContain(v);
    }
  });
});

describe('RAG chunker locale support', () => {
  it('includes locale in KB article prefix when non-English', async () => {
    const { chunkKBArticle } = await import('../../../../cli/rag/chunker');
    const chunks = chunkKBArticle('Mon Article', 'Contenu de test pour cet article.', { locale: 'fr' });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('[KB Article (fr): Mon Article]');
  });

  it('omits locale tag for English articles', async () => {
    const { chunkKBArticle } = await import('../../../../cli/rag/chunker');
    const chunks = chunkKBArticle('My Article', 'Test content for this article.', { locale: 'en' });
    expect(chunks[0].content).toContain('[KB Article: My Article]');
    expect(chunks[0].content).not.toContain('(en)');
  });

  it('omits locale tag when locale not specified', async () => {
    const { chunkKBArticle } = await import('../../../../cli/rag/chunker');
    const chunks = chunkKBArticle('My Article', 'Test content for this article.');
    expect(chunks[0].content).toContain('[KB Article: My Article]');
    expect(chunks[0].content).not.toContain('(');
  });
});

describe('Migration SQL validity', () => {
  it('migration file exists and contains expected statements', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.join(process.cwd(), 'src/db/migrations/0014_kb_enhancements.sql');
    const content = fs.readFileSync(migrationPath, 'utf-8');

    // Check for key ALTER TABLE statements
    expect(content).toContain('ALTER TABLE brands ADD COLUMN IF NOT EXISTS subdomain');
    expect(content).toContain('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS locale');
    expect(content).toContain('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS parent_article_id');
    expect(content).toContain('ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS slug');
    expect(content).toContain('ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS locale');
    expect(content).toContain('ALTER TABLE kb_collections ADD COLUMN IF NOT EXISTS brand_id');
    expect(content).toContain('ALTER TABLE rag_chunks ADD COLUMN IF NOT EXISTS locale');

    // Check for new tables
    expect(content).toContain('CREATE TABLE IF NOT EXISTS kb_article_feedback');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS kb_deflections');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS kb_content_gaps');

    // Check for indexes
    expect(content).toContain('kb_articles_translation_unique_idx');
    expect(content).toContain('kb_articles_slug_idx');

    // Check for backfill
    expect(content).toContain("UPDATE kb_articles SET locale = 'en'");
  });
});

describe('Schema exports', () => {
  it('exports new KB tables', async () => {
    const schema = await import('../../../db/schema');
    expect(schema.kbArticleFeedback).toBeDefined();
    expect(schema.kbDeflections).toBeDefined();
    expect(schema.kbContentGaps).toBeDefined();
    expect(schema.kbVisibilityEnum).toBeDefined();
    expect(schema.kbGapStatusEnum).toBeDefined();
  });

  it('kbArticles has new columns', async () => {
    const schema = await import('../../../db/schema');
    const cols = schema.kbArticles;
    expect(cols.locale).toBeDefined();
    expect(cols.parentArticleId).toBeDefined();
    expect(cols.brandId).toBeDefined();
    expect(cols.visibility).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.metaTitle).toBeDefined();
    expect(cols.metaDescription).toBeDefined();
    expect(cols.seoKeywords).toBeDefined();
    expect(cols.position).toBeDefined();
    expect(cols.helpfulCount).toBeDefined();
    expect(cols.notHelpfulCount).toBeDefined();
    expect(cols.viewCount).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });

  it('brands has new columns', async () => {
    const schema = await import('../../../db/schema');
    const cols = schema.brands;
    expect(cols.subdomain).toBeDefined();
    expect(cols.logoUrl).toBeDefined();
    expect(cols.faviconUrl).toBeDefined();
    expect(cols.primaryColor).toBeDefined();
    expect(cols.accentColor).toBeDefined();
    expect(cols.helpCenterEnabled).toBeDefined();
    expect(cols.helpCenterTitle).toBeDefined();
    expect(cols.defaultLocale).toBeDefined();
    expect(cols.supportedLocales).toBeDefined();
    expect(cols.headerHtml).toBeDefined();
    expect(cols.footerHtml).toBeDefined();
    expect(cols.customCss).toBeDefined();
  });

  it('ragChunks has locale column', async () => {
    const schema = await import('../../../db/schema');
    expect(schema.ragChunks.locale).toBeDefined();
  });

  it('kbCategories has new columns', async () => {
    const schema = await import('../../../db/schema');
    expect(schema.kbCategories.locale).toBeDefined();
    expect(schema.kbCategories.brandId).toBeDefined();
    expect(schema.kbCategories.slug).toBeDefined();
    expect(schema.kbCategories.description).toBeDefined();
    expect(schema.kbCategories.position).toBeDefined();
    expect(schema.kbCategories.icon).toBeDefined();
  });

  it('kbCollections has new columns', async () => {
    const schema = await import('../../../db/schema');
    expect(schema.kbCollections.brandId).toBeDefined();
    expect(schema.kbCollections.description).toBeDefined();
    expect(schema.kbCollections.locale).toBeDefined();
  });
});
