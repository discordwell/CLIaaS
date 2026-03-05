import { NextResponse } from 'next/server';
import { getCategories, getThreads } from '@/lib/forums/forum-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/forums — public listing of forum categories with thread counts
 */
export async function GET() {
  const categories = getCategories();

  const result = categories.map((cat) => {
    const threads = getThreads(cat.id);
    return {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      slug: cat.slug,
      threadCount: threads.length,
    };
  });

  return NextResponse.json({ categories: result });
}
