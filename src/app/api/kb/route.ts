import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles, createKBArticle } from '@/lib/data';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'kb:read');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q')?.toLowerCase();
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    let articles: Array<{
      id: string;
      title: string;
      body: string;
      categoryPath: string[];
      status: string;
      updatedAt: string;
    }>;

    // In DB mode, query directly with workspace filter from auth
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
          .where(eq(schema.kbArticles.workspaceId, auth.user.workspaceId));

        articles = rows.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          categoryPath: r.categoryPath ?? [],
          status: r.status ?? 'published',
          updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
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
      { error: err instanceof Error ? err.message : 'Failed to load articles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireScope(request, 'kb:write');
  if ('error' in auth) return auth.error;

  try {
    const parsed = await parseJsonBody<{
      title?: string;
      body?: string;
      categoryPath?: string[];
      status?: string;
    }>(request);
    if ('error' in parsed) return parsed.error;
    const { title, body: articleBody, categoryPath, status: articleStatus } = parsed.data;

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
    });

    return NextResponse.json({ article }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create article';
    const status = message.includes('not configured') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
