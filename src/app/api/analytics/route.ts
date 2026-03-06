import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { computeAnalytics } from '@/lib/analytics';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view', 'admin');
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
  } catch {
    // computeAnalytics has its own try/catch returning emptyAnalytics(),
    // so this is a last-resort fallback for unexpected outer errors
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      totalTickets: 0, ticketsCreated: [], ticketsByChannel: {}, ticketsBySource: {},
      avgResponseTimeHours: 0, avgResolutionTimeHours: 0,
      firstResponseSLA: { met: 0, breached: 0 }, resolutionSLA: { met: 0, breached: 0 },
      agentPerformance: [], csatOverall: 0, csatTrend: [],
      npsScore: 0, npsTrend: [], npsBreakdown: { promoters: 0, passives: 0, detractors: 0 },
      cesScore: 0, cesTrend: [], topTags: [], priorityDistribution: {},
      periodComparison: {
        current: { tickets: 0, avgResponseHours: 0, resolved: 0 },
        previous: { tickets: 0, avgResponseHours: 0, resolved: 0 },
      },
      dateRange: { from: today, to: today },
    });
  }
}
