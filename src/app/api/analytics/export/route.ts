import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { computeAnalytics, analyticsToCSV } from '@/lib/analytics';
import { requireRole } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const format = searchParams.get('format') ?? 'json';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let dateRange: { from: Date; to: Date } | undefined;
    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (!isNaN(fromDate.getTime()) && !isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateRange = { from: fromDate, to: toDate };
      }
    }

    const data = await computeAnalytics(dateRange);

    if (format === 'csv') {
      const csv = analyticsToCSV(data);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="cliaas-analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // JSON download
    const json = JSON.stringify(data, null, 2);
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="cliaas-analytics-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export analytics' },
      { status: 500 }
    );
  }
}
