import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/kb/:idOrSlug — public article detail by ID or slug.
 * Increments view_count and returns full article with SEO metadata.
 * No auth required (portal is public).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idOrSlug } = await params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    // Try DB first
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and, sql } = await import('drizzle-orm');

        const condition = isUUID
          ? eq(schema.kbArticles.id, idOrSlug)
          : eq(schema.kbArticles.slug, idOrSlug);

        const [article] = await db
          .select({
            id: schema.kbArticles.id,
            title: schema.kbArticles.title,
            body: schema.kbArticles.body,
            categoryPath: schema.kbArticles.categoryPath,
            status: schema.kbArticles.status,
            locale: schema.kbArticles.locale,
            slug: schema.kbArticles.slug,
            metaTitle: schema.kbArticles.metaTitle,
            metaDescription: schema.kbArticles.metaDescription,
            seoKeywords: schema.kbArticles.seoKeywords,
            viewCount: schema.kbArticles.viewCount,
            helpfulCount: schema.kbArticles.helpfulCount,
            notHelpfulCount: schema.kbArticles.notHelpfulCount,
            createdAt: schema.kbArticles.createdAt,
            updatedAt: schema.kbArticles.updatedAt,
          })
          .from(schema.kbArticles)
          .where(
            and(
              condition,
              eq(schema.kbArticles.visibility, 'public'),
            ),
          )
          .limit(1);

        if (!article) {
          return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 },
          );
        }

        // Increment view_count
        await db
          .update(schema.kbArticles)
          .set({ viewCount: sql`${schema.kbArticles.viewCount} + 1` })
          .where(eq(schema.kbArticles.id, article.id));

        return NextResponse.json({
          article: {
            id: article.id,
            title: article.title,
            body: article.body,
            categoryPath: article.categoryPath ?? [],
            status: article.status,
            locale: article.locale ?? 'en',
            slug: article.slug,
            metaTitle: article.metaTitle ?? article.title,
            metaDescription:
              article.metaDescription ??
              article.body.slice(0, 160).replace(/\n/g, ' '),
            seoKeywords: article.seoKeywords ?? [],
            viewCount: (article.viewCount ?? 0) + 1,
            helpfulCount: article.helpfulCount ?? 0,
            notHelpfulCount: article.notHelpfulCount ?? 0,
            createdAt: article.createdAt?.toISOString(),
            updatedAt: article.updatedAt?.toISOString(),
          },
        });
      } catch {
        // DB unavailable, fall through to JSONL
      }
    }

    // JSONL fallback — find by slug or ID
    const articles = await loadKBArticles();
    const article = articles.find(
      (a) =>
        (a.slug === idOrSlug || a.id === idOrSlug) &&
        (!a.visibility || a.visibility === 'public'),
    );

    if (!article) {
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      article: {
        id: article.id,
        title: article.title,
        body: article.body,
        categoryPath: article.categoryPath ?? [],
        status: article.status ?? 'published',
        locale: article.locale ?? 'en',
        slug: article.slug,
        metaTitle: article.metaTitle ?? article.title,
        metaDescription:
          article.metaDescription ??
          article.body.slice(0, 160).replace(/\n/g, ' '),
        seoKeywords: article.seoKeywords ?? [],
        viewCount: (article.viewCount ?? 0) + 1,
        helpfulCount: article.helpfulCount ?? 0,
        notHelpfulCount: article.notHelpfulCount ?? 0,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load article' },
      { status: 500 },
    );
  }
}
