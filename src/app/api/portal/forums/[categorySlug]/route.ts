import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCategories, getThreads } from '@/lib/forums/forum-store';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

const PORTAL_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120 };

/**
 * GET /api/portal/forums/:categorySlug — public listing of threads for a category
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ categorySlug: string }> },
) {
  const clientIp = request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
    || 'unknown';
  const rateResult = checkRateLimit(`portal-forums:${clientIp}`, PORTAL_RATE_LIMIT);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: getRateLimitHeaders(rateResult, PORTAL_RATE_LIMIT) },
    );
  }

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
