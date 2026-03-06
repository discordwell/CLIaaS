import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const daysAhead = parseInt(searchParams.get('daysAhead') ?? '7', 10) || 7;
  const channel = searchParams.get('channel') ?? undefined;

  const { getVolumeSnapshots } = await import('@/lib/wfm/store');
  const { generateForecast, calculateStaffing } = await import('@/lib/wfm/forecast');
  const { getSchedules } = await import('@/lib/wfm/schedules');

  let snapshots = getVolumeSnapshots();
  if (channel) {
    snapshots = snapshots.filter(s => s.channel === channel);
  }

  const forecast = generateForecast(snapshots, { daysAhead });
  const schedules = getSchedules();
  const staffing = calculateStaffing(forecast, schedules);

  return NextResponse.json({ forecast, staffing });
}
