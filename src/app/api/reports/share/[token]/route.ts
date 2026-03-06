import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { executeReport } from '@/lib/reports/engine';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Sharing not available in demo mode' }, { status: 404 });
    }

    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const [row] = await db.select().from(schema.reports)
      .where(eq(schema.reports.shareToken, token))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Shared report not found' }, { status: 404 });

    const reportDef = {
      metric: row.metric,
      groupBy: row.groupBy ?? [],
      filters: (row.filters ?? {}) as Record<string, unknown>,
    };

    const dateRange = row.dateRange as { from: string; to: string } | null;
    const result = await executeReport(reportDef, dateRange ?? undefined);

    return NextResponse.json({
      report: { name: row.name, description: row.description, visualization: row.visualization },
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shared report' },
      { status: 500 },
    );
  }
}
