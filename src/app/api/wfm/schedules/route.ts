import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') ?? undefined;

  const { getSchedules } = await import('@/lib/wfm/schedules');
  const schedules = getSchedules(userId);

  return NextResponse.json({ schedules, total: schedules.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    userId: string;
    userName: string;
    templateId?: string;
    effectiveFrom: string;
    effectiveTo?: string;
    timezone?: string;
    shifts?: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      activity?: string;
      label?: string;
    }>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { userId, userName, templateId, effectiveFrom, effectiveTo, timezone, shifts } = parsed.data;

  if (!userId || !userName || !effectiveFrom) {
    return NextResponse.json({ error: 'userId, userName, and effectiveFrom are required' }, { status: 400 });
  }

  const { createSchedule, applyTemplate } = await import('@/lib/wfm/schedules');

  const schedule = createSchedule({
    userId,
    userName,
    templateId,
    effectiveFrom,
    effectiveTo,
    timezone: timezone ?? 'UTC',
    shifts: shifts ?? [],
  });

  if (templateId) {
    applyTemplate(schedule.id, templateId);
  }

  return NextResponse.json({ schedule }, { status: 201 });
}
