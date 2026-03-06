import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId') ?? undefined;
  const status = searchParams.get('status') as 'pending' | 'approved' | 'denied' | null;

  const { getTimeOffRequests } = await import('@/lib/wfm/time-off');
  const requests = getTimeOffRequests(userId, status ?? undefined);

  return NextResponse.json({ requests, total: requests.length });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    userId: string;
    userName: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { userId, userName, startDate, endDate, reason } = parsed.data;

  if (!userId || !userName || !startDate || !endDate) {
    return NextResponse.json({ error: 'userId, userName, startDate, and endDate are required' }, { status: 400 });
  }

  const { requestTimeOff } = await import('@/lib/wfm/time-off');
  const timeOffRequest = requestTimeOff({ userId, userName, startDate, endDate, reason });

  return NextResponse.json({ request: timeOffRequest }, { status: 201 });
}
