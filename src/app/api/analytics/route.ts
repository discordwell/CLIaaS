import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { computeAnalytics } from '@/lib/analytics';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let dateRange: { from: Date; to: Date } | undefined;
    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
        // Set to end of day for the 'to' date
        toDate.setHours(23, 59, 59, 999);
        dateRange = { from: fromDate, to: toDate };
      }
    }

    const data = await computeAnalytics(dateRange);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to compute analytics' },
      { status: 500 }
    );
  }
}
