import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCategories, getThreads } from '@/lib/forums/forum-store';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

// Rate limit: 120 requests/min per IP for public portal
const PORTAL_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120 };

/**
 * GET /api/portal/forums — public listing of forum categories with thread counts
 */
export async function GET(request: NextRequest) {
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
  const categories = await getCategories();

  const result = await Promise.all(categories.map(async (cat) => {
    const threads = await getThreads(cat.id);
    return {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      slug: cat.slug,
      threadCount: threads.length,
    };
  }));

  return NextResponse.json({ categories: result });
}
