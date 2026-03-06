import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { getHealthScores, getAtRiskCustomers } from '@/lib/customers/health-score-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customers/health/overview — health score distribution and at-risk list
 */
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'customers:view');
  if ('error' in auth) return auth.error;

  const wsId = auth.user.workspaceId ?? 'default';
  const allScores = getHealthScores({ workspaceId: wsId });
  const atRisk = getAtRiskCustomers(wsId, 20);

  // Distribution
  const distribution = {
    excellent: allScores.filter(s => s.overallScore >= 80).length,
    good: allScores.filter(s => s.overallScore >= 60 && s.overallScore < 80).length,
    fair: allScores.filter(s => s.overallScore >= 40 && s.overallScore < 60).length,
    poor: allScores.filter(s => s.overallScore < 40).length,
  };

  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((s, h) => s + h.overallScore, 0) / allScores.length)
    : 0;

  const trendCounts = {
    improving: allScores.filter(s => s.trend === 'improving').length,
    stable: allScores.filter(s => s.trend === 'stable').length,
    declining: allScores.filter(s => s.trend === 'declining').length,
  };

  return NextResponse.json({
    totalCustomers: allScores.length,
    avgScore,
    distribution,
    trendCounts,
    atRisk: atRisk.map(s => ({
      customerId: s.customerId,
      overallScore: s.overallScore,
      trend: s.trend,
      computedAt: s.computedAt,
    })),
  });
}
