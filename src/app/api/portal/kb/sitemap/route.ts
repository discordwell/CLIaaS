import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import { loadKBArticles } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/kb/sitemap — Generate XML sitemap for all published KB articles.
 * No auth required (public portal).
 */
export async function GET() {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://cliaas.com';

    interface SitemapArticle {
      slug?: string;
      updatedAt?: string;
      locale?: string;
    }

    let articles: SitemapArticle[] = [];

    // Try DB first
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');
        const { getDefaultWorkspaceId } = await import('@/lib/store-helpers');
        const wsId = await getDefaultWorkspaceId(db, schema);

        const rows = await db
          .select({
            slug: schema.kbArticles.slug,
            updatedAt: schema.kbArticles.updatedAt,
            locale: schema.kbArticles.locale,
          })
          .from(schema.kbArticles)
          .where(and(
            eq(schema.kbArticles.workspaceId, wsId),
            eq(schema.kbArticles.visibility, 'public'),
            eq(schema.kbArticles.status, 'published'),
          ));

        articles = rows
          .filter((r) => r.slug)
          .map((r) => ({
            slug: r.slug ?? undefined,
            updatedAt: r.updatedAt?.toISOString(),
            locale: r.locale ?? 'en',
          }));
      } catch {
        // Fall through to JSONL
      }
    }

    // JSONL fallback
    if (articles.length === 0) {
      const all = await loadKBArticles();
      articles = all
        .filter((a) => (!a.visibility || a.visibility === 'public') && a.slug)
        .map((a) => ({
          slug: a.slug,
          updatedAt: a.updatedAt,
          locale: a.locale ?? 'en',
        }));
    }

    const urls = articles
      .map((a) => {
        const lastmod = a.updatedAt
          ? `<lastmod>${a.updatedAt.split('T')[0]}</lastmod>`
          : '';
        const safeLoc = `${base}/portal/kb/${a.slug}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `  <url>
    <loc>${safeLoc}</loc>
    ${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate sitemap') },
      { status: 500 },
    );
  }
}
