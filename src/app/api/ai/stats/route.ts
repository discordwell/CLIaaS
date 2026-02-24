import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getROIMetrics } from '@/lib/ai/roi-tracker';
import { getAgentStats } from '@/lib/ai/agent';
import { getPendingApprovals } from '@/lib/ai/approval-queue';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const roi = getROIMetrics();
  const agent = getAgentStats();
  const pendingCount = getPendingApprovals().length;

  return NextResponse.json({
    roi,
    agent: {
      totalRuns: agent.totalRuns,
      resolved: agent.resolved,
      escalated: agent.escalated,
      avgConfidence: agent.avgConfidence,
    },
    pendingApprovals: pendingCount,
  });
}
