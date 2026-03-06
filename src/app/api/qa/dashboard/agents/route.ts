import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getReviews } from '@/lib/qa/qa-store';
import { getFlags } from '@/lib/qa/qa-flags-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/dashboard/agents — per-agent quality breakdown
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const reviews = getReviews({ status: 'completed', workspaceId: wsId });
  const flags = getFlags({ workspaceId: wsId, dismissed: false });

  // Group reviews by reviewerId (agent)
  const agentMap = new Map<string, {
    agentId: string;
    reviewCount: number;
    totalScore: number;
    totalMax: number;
    flagCount: number;
    latestReviewAt: string;
  }>();

  for (const review of reviews) {
    const agentId = review.reviewerId ?? 'unknown';
    if (agentId === 'autoqa' || agentId === 'auto') continue; // skip auto reviews for agent stats

    const existing = agentMap.get(agentId) ?? {
      agentId,
      reviewCount: 0,
      totalScore: 0,
      totalMax: 0,
      flagCount: 0,
      latestReviewAt: review.createdAt,
    };

    existing.reviewCount++;
    existing.totalScore += review.totalScore;
    existing.totalMax += review.maxPossibleScore;
    if (new Date(review.createdAt) > new Date(existing.latestReviewAt)) {
      existing.latestReviewAt = review.createdAt;
    }

    agentMap.set(agentId, existing);
  }

  // Count flags per agent (by ticket assignee — approximate via reviewerId)
  for (const flag of flags) {
    const review = reviews.find(r => r.id === flag.reviewId);
    if (review?.reviewerId && agentMap.has(review.reviewerId)) {
      agentMap.get(review.reviewerId)!.flagCount++;
    }
  }

  const agents = Array.from(agentMap.values()).map(a => ({
    agentId: a.agentId,
    reviewCount: a.reviewCount,
    avgScore: a.totalMax > 0 ? Math.round((a.totalScore / a.totalMax) * 10000) / 100 : 0,
    flagCount: a.flagCount,
    latestReviewAt: a.latestReviewAt,
  })).sort((a, b) => b.reviewCount - a.reviewCount);

  return NextResponse.json({ agents });
}
