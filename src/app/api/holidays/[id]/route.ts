import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth, requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
  const calendars = listHolidayCalendars(id);
  if (calendars.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ calendar: calendars[0] });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ name?: string; description?: string }>(request);
  if ('error' in parsed) return parsed.error;

  const { updateCalendar } = await import('@/lib/wfm/holidays');
  const updated = updateCalendar(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ calendar: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const { deleteHolidayCalendar } = await import('@/lib/wfm/holidays');
  const deleted = deleteHolidayCalendar(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
