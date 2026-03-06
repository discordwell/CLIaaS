import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  const { getTimeEntries } = await import('@/lib/time-tracking');
  const { getStatusLog } = await import('@/lib/wfm/store');
  const { getSchedules } = await import('@/lib/wfm/schedules');
  const { calculateUtilization } = await import('@/lib/wfm/utilization');

  const timeEntries = getTimeEntries({ userId, from, to });
  const statusLog = getStatusLog();
  const schedules = getSchedules(userId);

  const utilization = calculateUtilization(timeEntries, statusLog, schedules, { userId, from, to });

  return NextResponse.json({ utilization, total: utilization.length });
}
