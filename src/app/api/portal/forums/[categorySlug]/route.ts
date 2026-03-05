import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCategories, getThreads } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/forums/:categorySlug — public listing of threads for a category
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ categorySlug: string }> },
) {
  const { categorySlug } = await params;

  const categories = getCategories();
  const category = categories.find((c) => c.slug === categorySlug);

  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  const threads = getThreads(category.id);

  return NextResponse.json({
    category: {
      id: category.id,
      name: category.name,
      description: category.description,
      slug: category.slug,
    },
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      isPinned: t.isPinned,
      viewCount: t.viewCount,
      replyCount: t.replyCount,
      lastActivityAt: t.lastActivityAt,
      createdAt: t.createdAt,
    })),
  });
}
