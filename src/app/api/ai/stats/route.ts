import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getROIMetrics } from '@/lib/ai/roi-tracker';
import { getAgentStats } from '@/lib/ai/agent';
import { getPendingApprovals } from '@/lib/ai/approval-queue';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'automation:view');
  if ('error' in auth) return auth.error;

  const roi = getROIMetrics();
  const agent = getAgentStats();
  const pending = await getPendingApprovals();
  const pendingCount = pending.length;

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
