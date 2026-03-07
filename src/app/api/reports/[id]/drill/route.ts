import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { drillDown } from '@/lib/reports/engine';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    groupKey: string;
    groupValue: string;
    dateRange?: { from: string; to: string };
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { groupKey, groupValue, dateRange } = parsed.data;
  if (!groupKey || !groupValue) {
    return NextResponse.json({ error: 'groupKey and groupValue are required' }, { status: 400 });
  }

  try {
    let reportDef;

    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [row] = await db.select().from(schema.reports)
        .where(and(eq(schema.reports.id, id), eq(schema.reports.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

      reportDef = {
        metric: row.metric,
        groupBy: row.groupBy ?? [],
        filters: (row.filters ?? {}) as Record<string, unknown>,
      };
    } else {
      const { REPORT_TEMPLATES } = await import('@/lib/reports/templates');
      const idx = parseInt(id.replace('template-', ''), 10);
      const template = REPORT_TEMPLATES[idx];
      if (!template) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      reportDef = template;
    }

    const result = await drillDown(reportDef, groupKey, groupValue, dateRange);

    return NextResponse.json({ drillDown: result });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to drill down') },
      { status: 500 },
    );
  }
}
