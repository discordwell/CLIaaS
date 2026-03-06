import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    templateId?: string;
    effectiveFrom?: string;
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

  const { updateSchedule } = await import('@/lib/wfm/schedules');
  const schedule = updateSchedule(id, parsed.data);

  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  return NextResponse.json({ schedule });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { deleteSchedule } = await import('@/lib/wfm/schedules');
  const deleted = deleteSchedule(id);

  if (!deleted) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
