import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTimeEntries, logManualTime } from '@/lib/time-tracking';
import { parseJsonBody } from '@/lib/parse-json-body';
import { requireAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      ticketId: searchParams.get('ticketId') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      billable: searchParams.has('billable')
        ? searchParams.get('billable') === 'true'
        : undefined,
    };

    const entries = getTimeEntries(filters);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get time entries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { ticketId, userId, userName, durationMinutes, billable, notes } = parsed.data;

    if (!ticketId || !userId || !userName || !durationMinutes) {
      return NextResponse.json(
        { error: 'ticketId, userId, userName, and durationMinutes are required' },
        { status: 400 }
      );
    }

    const entry = logManualTime({
      ticketId,
      userId,
      userName,
      durationMinutes: parseInt(durationMinutes, 10),
      billable: billable ?? true,
      notes: notes ?? '',
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to log time' },
      { status: 500 }
    );
  }
}
