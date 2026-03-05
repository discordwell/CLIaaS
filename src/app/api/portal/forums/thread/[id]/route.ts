import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getThread, getReplies } from '@/lib/forums/forum-store';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/security/rate-limiter';

export const dynamic = 'force-dynamic';

const PORTAL_RATE_LIMIT = { windowMs: 60_000, maxRequests: 120 };

/**
 * GET /api/portal/forums/thread/:id — public thread detail with replies
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params;

  const thread = getThread(id);
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const replies = getReplies(id);

  return NextResponse.json({
    thread: {
      id: thread.id,
      categoryId: thread.categoryId,
      title: thread.title,
      body: thread.body,
      status: thread.status,
      isPinned: thread.isPinned,
      viewCount: thread.viewCount,
      replyCount: thread.replyCount,
      lastActivityAt: thread.lastActivityAt,
      convertedTicketId: thread.convertedTicketId,
      createdAt: thread.createdAt,
    },
    replies: replies.map((r) => ({
      id: r.id,
      body: r.body,
      isBestAnswer: r.isBestAnswer,
      createdAt: r.createdAt,
    })),
  });
}
