import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getScorecards, createReview } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/qa/reviews/auto — trigger an auto-review for a ticket
 *
 * Uses the first enabled scorecard and generates random scores for demo purposes.
 * In production, this would call an LLM to evaluate the conversation.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    ticketId?: string;
    conversationId?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { ticketId, conversationId } = parsed.data;

  if (!ticketId && !conversationId) {
    return NextResponse.json(
      { error: 'Either ticketId or conversationId is required' },
      { status: 400 },
    );
  }

  const scorecards = getScorecards();
  const activeScorecard = scorecards.find((s) => s.enabled);

  if (!activeScorecard) {
    return NextResponse.json(
      { error: 'No active scorecard found. Create and enable a scorecard first.' },
      { status: 400 },
    );
  }

  // Generate scores (demo: random within maxScore range)
  const scores: Record<string, number> = {};
  let maxPossibleScore = 0;

  for (const criterion of activeScorecard.criteria) {
    const score = Math.floor(Math.random() * criterion.maxScore) + 1;
    scores[criterion.name] = score;
    maxPossibleScore += criterion.maxScore;
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  const review = createReview({
    ticketId,
    conversationId,
    scorecardId: activeScorecard.id,
    reviewerId: 'auto',
    reviewType: 'auto',
    scores,
    totalScore,
    maxPossibleScore,
    notes: 'Auto-generated review based on conversation analysis.',
    status: 'completed',
    workspaceId: auth.user.workspaceId,
  });

  return NextResponse.json({ review }, { status: 201 });
}
