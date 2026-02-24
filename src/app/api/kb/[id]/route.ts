import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles } from '@/lib/data';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireScope(request, 'kb:read');
  if ('error' in auth) return auth.error;

  try {
    const { id } = await params;

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const rows = await db
          .select({
            id: schema.kbArticles.id,
            title: schema.kbArticles.title,
            body: schema.kbArticles.body,
            categoryPath: schema.kbArticles.categoryPath,
            status: schema.kbArticles.status,
            updatedAt: schema.kbArticles.updatedAt,
          })
          .from(schema.kbArticles)
          .where(eq(schema.kbArticles.id, id))
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
  const auth = await requireScope(request, 'kb:write');
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
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { title, body: articleBody, categoryPath, status: articleStatus } = parsed.data;

    if (!title && !articleBody && !categoryPath && !articleStatus) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title) updates.title = title.trim();
    if (articleBody) updates.body = articleBody.trim();
    if (categoryPath) updates.categoryPath = categoryPath;
    if (articleStatus) updates.status = articleStatus;

    const rows = await db
      .update(schema.kbArticles)
      .set(updates)
      .where(eq(schema.kbArticles.id, id))
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
  const auth = await requireScope(request, 'kb:write');
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
    const { eq } = await import('drizzle-orm');

    // Delete revisions first
    await db
      .delete(schema.kbRevisions)
      .where(eq(schema.kbRevisions.articleId, id));

    const rows = await db
      .delete(schema.kbArticles)
      .where(eq(schema.kbArticles.id, id))
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
