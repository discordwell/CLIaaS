import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTimeReport } from '@/lib/time-tracking';
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

    const report = getTimeReport(filters);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate time report' },
      { status: 500 }
    );
  }
}
