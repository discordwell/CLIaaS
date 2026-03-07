import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles, createKBArticle } from '@/lib/data';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'kb:view');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q')?.toLowerCase();
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const locale = searchParams.get('locale');
    const brandId = searchParams.get('brandId');
    const visibility = searchParams.get('visibility');

    let articles: Array<{
      id: string;
      title: string;
      body: string;
      categoryPath: string[];
      status: string;
      updatedAt: string;
      locale?: string;
      brandId?: string;
      visibility?: string;
      slug?: string;
      parentArticleId?: string;
      helpfulCount?: number;
      notHelpfulCount?: number;
      viewCount?: number;
      position?: number;
    }>;

    // In DB mode, query directly with workspace filter from auth
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        const conditions = [eq(schema.kbArticles.workspaceId, auth.user.workspaceId)];
        if (locale) conditions.push(eq(schema.kbArticles.locale, locale));
        if (brandId) conditions.push(eq(schema.kbArticles.brandId, brandId));
        if (visibility) conditions.push(eq(schema.kbArticles.visibility, visibility));

        const rows = await db
          .select({
            id: schema.kbArticles.id,
            title: schema.kbArticles.title,
            body: schema.kbArticles.body,
            categoryPath: schema.kbArticles.categoryPath,
            status: schema.kbArticles.status,
            updatedAt: schema.kbArticles.updatedAt,
            locale: schema.kbArticles.locale,
            brandId: schema.kbArticles.brandId,
            visibility: schema.kbArticles.visibility,
            slug: schema.kbArticles.slug,
            parentArticleId: schema.kbArticles.parentArticleId,
            helpfulCount: schema.kbArticles.helpfulCount,
            notHelpfulCount: schema.kbArticles.notHelpfulCount,
            viewCount: schema.kbArticles.viewCount,
            position: schema.kbArticles.position,
          })
          .from(schema.kbArticles)
          .where(and(...conditions));

        articles = rows.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          categoryPath: r.categoryPath ?? [],
          status: r.status ?? 'published',
          updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
          locale: r.locale ?? 'en',
          brandId: r.brandId ?? undefined,
          visibility: r.visibility ?? 'public',
          slug: r.slug ?? undefined,
          parentArticleId: r.parentArticleId ?? undefined,
          helpfulCount: r.helpfulCount ?? 0,
          notHelpfulCount: r.notHelpfulCount ?? 0,
          viewCount: r.viewCount ?? 0,
          position: r.position ?? 0,
        }));
      } catch {
        // DB unavailable, fall through to JSONL
        articles = (await loadKBArticles()).map((a) => ({
          ...a,
          status: a.status ?? 'published',
          updatedAt: a.updatedAt ?? new Date().toISOString(),
        }));
      }
    } else {
      articles = (await loadKBArticles()).map((a) => ({
        ...a,
        status: a.status ?? 'published',
        updatedAt: a.updatedAt ?? new Date().toISOString(),
      }));
    }

    if (status) {
      articles = articles.filter((a) => a.status === status);
    }

    if (category) {
      articles = articles.filter((a) =>
        a.categoryPath.some(
          (c) => c.toLowerCase() === category.toLowerCase()
        )
      );
    }

    if (query) {
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.body.toLowerCase().includes(query)
      );
    }

    return NextResponse.json({ articles, total: articles.length });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load articles') },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'kb:edit');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      title?: string;
      body?: string;
      categoryPath?: string[];
      status?: string;
      locale?: string;
      parentArticleId?: string;
      brandId?: string;
      visibility?: string;
      slug?: string;
      metaTitle?: string;
      metaDescription?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const {
      title, body: articleBody, categoryPath, status: articleStatus,
      locale, parentArticleId, brandId, visibility, slug, metaTitle, metaDescription,
    } = parsed.data;

    if (!title?.trim() || !articleBody?.trim()) {
      return NextResponse.json(
        { error: 'title and body are required' },
        { status: 400 }
      );
    }

    const article = await createKBArticle({
      title,
      body: articleBody,
      categoryPath,
      status: articleStatus,
      locale,
      parentArticleId,
      brandId,
      visibility: visibility as 'public' | 'internal' | 'draft' | undefined,
      slug,
      metaTitle,
      metaDescription,
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (err) {
    const message = safeErrorMessage(err, 'Failed to create article');
    const status = message.includes('not configured') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
