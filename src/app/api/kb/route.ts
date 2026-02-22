import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q')?.toLowerCase();
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    // Try DB
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import('@/db');
        const schema = await import('@/db/schema');

        let rows = await db
          .select({
            id: schema.kbArticles.id,
            title: schema.kbArticles.title,
            body: schema.kbArticles.body,
            categoryPath: schema.kbArticles.categoryPath,
            status: schema.kbArticles.status,
            updatedAt: schema.kbArticles.updatedAt,
          })
          .from(schema.kbArticles)
          .orderBy(schema.kbArticles.updatedAt);

        let articles = rows.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          categoryPath: r.categoryPath ?? [],
          status: r.status,
          updatedAt: r.updatedAt.toISOString(),
        }));

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
      } catch {
        // DB unavailable, fall through
      }
    }

    // JSONL fallback
    let articles = await loadKBArticles();

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

    return NextResponse.json({
      articles: articles.map((a) => ({
        ...a,
        status: 'published',
        updatedAt: new Date().toISOString(),
      })),
      total: articles.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load articles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const { title, body: articleBody, categoryPath, status: articleStatus } = body as {
      title?: string;
      body?: string;
      categoryPath?: string[];
      status?: string;
    };

    if (!title?.trim() || !articleBody?.trim()) {
      return NextResponse.json(
        { error: 'title and body are required' },
        { status: 400 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured. KB authoring requires a database.' },
        { status: 503 }
      );
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');

    // Get workspace
    let workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) {
      const rows = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .limit(1);
      workspaceId = rows[0]?.id;
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found' },
        { status: 400 }
      );
    }

    const [article] = await db
      .insert(schema.kbArticles)
      .values({
        workspaceId,
        title: title.trim(),
        body: articleBody.trim(),
        categoryPath: categoryPath ?? [],
        status: articleStatus ?? 'published',
      })
      .returning();

    return NextResponse.json({ article }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create article' },
      { status: 500 }
    );
  }
}
