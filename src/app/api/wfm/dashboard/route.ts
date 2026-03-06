import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
  const { getSchedules } = await import('@/lib/wfm/schedules');
  const { getCurrentAdherence } = await import('@/lib/wfm/adherence');
  const { getVolumeSnapshots } = await import('@/lib/wfm/store');
  const { generateForecast, calculateStaffing } = await import('@/lib/wfm/forecast');
  const { getTimeOffRequests } = await import('@/lib/wfm/time-off');
  const { getTimeEntries } = await import('@/lib/time-tracking');
  const { getStatusLog } = await import('@/lib/wfm/store');
  const { calculateUtilization } = await import('@/lib/wfm/utilization');

  const statuses = agentStatusTracker.getAllStatuses();
  const schedules = getSchedules();
  const adherence = getCurrentAdherence(schedules, statuses);
  const snapshots = getVolumeSnapshots();
  const forecast = generateForecast(snapshots);
  const staffing = calculateStaffing(forecast, schedules);
  const pendingTimeOff = getTimeOffRequests(undefined, 'pending');

  const timeEntries = getTimeEntries({});
  const statusLog = getStatusLog();
  const utilization = calculateUtilization(timeEntries, statusLog, schedules);

  return NextResponse.json({
    agentStatuses: statuses,
    adherence,
    utilization,
    forecast,
    staffing,
    pendingTimeOff,
  });
}
