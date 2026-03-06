import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getReviews, createReview } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/reviews — list QA reviews, optionally filtered by ?ticketId
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:view');
  if ('error' in auth) return auth.error;

  const ticketId = request.nextUrl.searchParams.get('ticketId') ?? undefined;
  const reviews = getReviews({ ticketId });

  return NextResponse.json({ reviews });
}

/**
 * POST /api/qa/reviews — create a QA review
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:review');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    ticketId?: string;
    conversationId?: string;
    scorecardId?: string;
    reviewType?: 'manual' | 'auto';
    scores?: Record<string, number>;
    totalScore?: number;
    maxPossibleScore?: number;
    notes?: string;
    status?: 'pending' | 'in_progress' | 'completed';
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { scorecardId, reviewType, scores, totalScore, maxPossibleScore, ...rest } = parsed.data;

  if (!scorecardId) {
    return NextResponse.json({ error: 'scorecardId is required' }, { status: 400 });
  }

  if (!scores || typeof scores !== 'object') {
    return NextResponse.json({ error: 'scores is required' }, { status: 400 });
  }

  const review = createReview({
    ...rest,
    scorecardId,
    reviewType: reviewType ?? 'manual',
    scores,
    totalScore: totalScore ?? Object.values(scores).reduce((a, b) => a + b, 0),
    maxPossibleScore: maxPossibleScore ?? 0,
    status: rest.status ?? 'completed',
    reviewerId: auth.user.id,
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ review }, { status: 201 });
}
