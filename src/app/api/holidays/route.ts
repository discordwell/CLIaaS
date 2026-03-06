import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
  const calendars = listHolidayCalendars();
  return NextResponse.json({ calendars, total: calendars.length });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    description?: string;
    entries?: Array<{ name: string; date: string; recurring?: boolean; startTime?: string; endTime?: string }>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, entries } = parsed.data;
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { createHolidayCalendar } = await import('@/lib/wfm/holidays');
  const calendar = createHolidayCalendar({ name, description, entries });
  return NextResponse.json({ calendar }, { status: 201 });
}
