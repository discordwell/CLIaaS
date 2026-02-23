import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles, createKBArticle } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q')?.toLowerCase();
    const category = searchParams.get('category');
    const status = searchParams.get('status');

    let articles = (await loadKBArticles()).map((a) => ({
      ...a,
      status: a.status ?? 'published',
      updatedAt: a.updatedAt ?? new Date().toISOString(),
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
