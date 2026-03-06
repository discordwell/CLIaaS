import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { getSchedules } = await import('@/lib/wfm/schedules');
  const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
  const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

  const schedules = getSchedules();
  const statuses = agentStatusTracker.getAllStatuses();
  const adherence = getCurrentAdherence(schedules, statuses);

  return NextResponse.json({ adherence, total: adherence.length });
}
