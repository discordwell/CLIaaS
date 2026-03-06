import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{
    name: string;
    date: string;
    recurring?: boolean;
    startTime?: string;
    endTime?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, date, startTime, endTime } = parsed.data;
  if (!name || !date) {
    return NextResponse.json({ error: 'name and date are required' }, { status: 400 });
  }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
  }

  // Validate optional time strings
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (startTime && !timeRe.test(startTime)) {
    return NextResponse.json({ error: `Invalid startTime: ${startTime}. Use HH:MM` }, { status: 400 });
  }
  if (endTime && !timeRe.test(endTime)) {
    return NextResponse.json({ error: `Invalid endTime: ${endTime}. Use HH:MM` }, { status: 400 });
  }

  const { addEntryToCalendar } = await import('@/lib/wfm/holidays');
  const updated = addEntryToCalendar(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
  }
  return NextResponse.json({ calendar: updated }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const parsed = await parseJsonBody<{ entryId: string }>(request);
  if ('error' in parsed) return parsed.error;

  if (!parsed.data.entryId) {
    return NextResponse.json({ error: 'entryId is required' }, { status: 400 });
  }

  const { removeEntryFromCalendar } = await import('@/lib/wfm/holidays');
  const updated = removeEntryFromCalendar(id, parsed.data.entryId);
  if (!updated) {
    return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });
  }
  return NextResponse.json({ calendar: updated });
}
