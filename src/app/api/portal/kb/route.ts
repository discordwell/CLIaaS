import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadKBArticles } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get('q')?.toLowerCase();
    const category = searchParams.get('category');

    let articles = await loadKBArticles();

    // Filter by category
    if (category) {
      articles = articles.filter((a) =>
        a.categoryPath.some(
          (c) => c.toLowerCase() === category.toLowerCase()
        )
      );
    }

    // Search filter
    if (query) {
      articles = articles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.body.toLowerCase().includes(query) ||
          a.categoryPath.some((c) => c.toLowerCase().includes(query))
      );
    }

    // Build category list
    const categorySet = new Set<string>();
    const allArticles = await loadKBArticles();
    for (const a of allArticles) {
      if (a.categoryPath[0]) {
        categorySet.add(a.categoryPath[0]);
      }
    }

    return NextResponse.json({
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        categoryPath: a.categoryPath,
        snippet: a.body.slice(0, 200) + (a.body.length > 200 ? '...' : ''),
      })),
      categories: Array.from(categorySet).sort(),
      total: articles.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load articles' },
      { status: 500 }
    );
  }
}
