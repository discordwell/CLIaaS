import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getReviews } from '@/lib/qa/qa-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qa/dashboard/trends — QA score trends over time (last 30 days by default)
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'qa:view');
  if ('error' in auth) return auth.error;

  const rawDays = parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const wsId = auth.user.workspaceId ?? 'default';
  const reviews = getReviews({ status: 'completed', workspaceId: wsId }).filter(
    r => new Date(r.createdAt) >= cutoff,
  );

  // Group by date
  const byDate = new Map<string, { totalScore: number; totalMax: number; count: number }>();

  for (const review of reviews) {
    const dateKey = new Date(review.createdAt).toISOString().slice(0, 10);
    const existing = byDate.get(dateKey) ?? { totalScore: 0, totalMax: 0, count: 0 };
    existing.totalScore += review.totalScore;
    existing.totalMax += review.maxPossibleScore;
    existing.count++;
    byDate.set(dateKey, existing);
  }

  const trends = Array.from(byDate.entries())
    .map(([date, data]) => ({
      date,
      avgPercentage: data.totalMax > 0 ? Math.round((data.totalScore / data.totalMax) * 10000) / 100 : 0,
      reviewCount: data.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ trends, days, totalReviews: reviews.length });
}
