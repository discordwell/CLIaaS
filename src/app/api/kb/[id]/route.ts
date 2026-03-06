import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles } from '@/lib/data';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:view');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq, and } = await import('drizzle-orm');

        // Scope by workspace to prevent cross-workspace data leakage
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
            metaTitle: schema.kbArticles.metaTitle,
            metaDescription: schema.kbArticles.metaDescription,
            seoKeywords: schema.kbArticles.seoKeywords,
            helpfulCount: schema.kbArticles.helpfulCount,
            notHelpfulCount: schema.kbArticles.notHelpfulCount,
            viewCount: schema.kbArticles.viewCount,
            position: schema.kbArticles.position,
            createdAt: schema.kbArticles.createdAt,
          })
          .from(schema.kbArticles)
          .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
          .limit(1);

        if (rows.length === 0) {
          return NextResponse.json(
            { error: 'Article not found' },
            { status: 404 }
          );
        }

        const article = rows[0];
        return NextResponse.json({
          article: {
            id: article.id,
            title: article.title,
            body: article.body,
            categoryPath: article.categoryPath ?? [],
            status: article.status,
            updatedAt: article.updatedAt.toISOString(),
            locale: article.locale ?? 'en',
            brandId: article.brandId ?? undefined,
            visibility: article.visibility ?? 'public',
            slug: article.slug ?? undefined,
            parentArticleId: article.parentArticleId ?? undefined,
            metaTitle: article.metaTitle ?? undefined,
            metaDescription: article.metaDescription ?? undefined,
            seoKeywords: article.seoKeywords ?? undefined,
            helpfulCount: article.helpfulCount ?? 0,
            notHelpfulCount: article.notHelpfulCount ?? 0,
            viewCount: article.viewCount ?? 0,
            position: article.position ?? 0,
            createdAt: article.createdAt?.toISOString(),
          },
        });
      } catch {
        // DB unavailable, fall through
      }
    }

    // JSONL fallback
    const articles = await loadKBArticles();
    const article = articles.find((a) => a.id === id);

    if (!article) {
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      article: {
        ...article,
        status: 'published',
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load article' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:edit');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. KB editing requires a database.' },
        { status: 503 }
      );
    }

    const parsed = await parseJsonBody<{
      title?: string;
      body?: string;
      categoryPath?: string[];
      status?: string;
      locale?: string;
      visibility?: string;
      slug?: string;
      metaTitle?: string;
      metaDescription?: string;
      seoKeywords?: string[];
      position?: number;
      brandId?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;

    if (!d.title && !d.body && !d.categoryPath && !d.status && !d.locale
        && !d.visibility && !d.slug && d.metaTitle === undefined
        && d.metaDescription === undefined && !d.seoKeywords
        && d.position === undefined && !d.brandId) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (d.title) updates.title = d.title.trim();
    if (d.body) updates.body = d.body.trim();
    if (d.categoryPath) updates.categoryPath = d.categoryPath;
    if (d.status) updates.status = d.status;
    if (d.locale) updates.locale = d.locale;
    if (d.visibility) updates.visibility = d.visibility;
    if (d.slug) updates.slug = d.slug;
    if (d.metaTitle !== undefined) updates.metaTitle = d.metaTitle;
    if (d.metaDescription !== undefined) updates.metaDescription = d.metaDescription;
    if (d.seoKeywords) updates.seoKeywords = d.seoKeywords;
    if (d.position !== undefined) updates.position = d.position;
    if (d.brandId) updates.brandId = d.brandId;

    // Scope by workspace to prevent cross-workspace modification
    const rows = await db
      .update(schema.kbArticles)
      .set(updates)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .returning();

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ article: rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update article' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePerm(request, 'kb:edit');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. KB deletion requires a database.' },
        { status: 503 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    // Verify workspace ownership before deleting revisions
    const [existing] = await db
      .select({ id: schema.kbArticles.id })
      .from(schema.kbArticles)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 }
      );
    }

    // Delete revisions first (safe because we verified workspace ownership above)
    await db
      .delete(schema.kbRevisions)
      .where(eq(schema.kbRevisions.articleId, id));

    // Scope by workspace to prevent cross-workspace deletion
    const rows = await db
      .delete(schema.kbArticles)
      .where(and(eq(schema.kbArticles.id, id), eq(schema.kbArticles.workspaceId, auth.user.workspaceId)))
      .returning({ id: schema.kbArticles.id });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Article not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete article' },
      { status: 500 }
    );
  }
}
