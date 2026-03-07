import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { executeReport } from '@/lib/reports/engine';
import { computeCacheKey, getCached, setCache } from '@/lib/reports/cache';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    dateRange?: { from: string; to: string };
    overrides?: Record<string, unknown>;
  }>(request);
  if ('error' in parsed) return parsed.error;

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
        visualization: row.visualization,
        formula: row.formula ?? undefined,
      };
    } else {
      // JSONL mode: parse id as template index
      const { REPORT_TEMPLATES } = await import('@/lib/reports/templates');
      const idx = parseInt(id.replace('template-', ''), 10);
      const template = REPORT_TEMPLATES[idx];
      if (!template) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      reportDef = template;
    }

    const dateRange = parsed.data.dateRange;

    // Check cache
    const mergedFilters = parsed.data.overrides
      ? { ...reportDef.filters, ...parsed.data.overrides }
      : reportDef.filters;
    const cacheKey = computeCacheKey(id, mergedFilters, dateRange);
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json({ result: cached, cached: true });
    }

    const result = await executeReport(reportDef, dateRange, parsed.data.overrides);

    // Store in cache
    setCache(cacheKey, result, dateRange);

    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to execute report') },
      { status: 500 },
    );
  }
}
