import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, desc } = await import('drizzle-orm');

      const url = new URL(request.url);
      const templateOnly = url.searchParams.get('template') === 'true';

      let query = db.select().from(schema.reports)
        .where(eq(schema.reports.workspaceId, auth.user.workspaceId))
        .orderBy(desc(schema.reports.updatedAt));

      if (templateOnly) {
        const { and } = await import('drizzle-orm');
        query = db.select().from(schema.reports)
          .where(and(
            eq(schema.reports.workspaceId, auth.user.workspaceId),
            eq(schema.reports.isTemplate, true),
          ))
          .orderBy(desc(schema.reports.updatedAt));
      }

      const rows = await query;
      return NextResponse.json({ reports: rows });
    }

    // JSONL mode: no persistent reports, return templates
    const { REPORT_TEMPLATES } = await import('@/lib/reports/templates');
    return NextResponse.json({
      reports: REPORT_TEMPLATES.map((t, i) => ({
        id: `template-${i}`,
        name: t.name,
        description: t.description,
        metric: t.metric,
        groupBy: t.groupBy,
        visualization: t.visualization,
        isTemplate: true,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list reports' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody<{
    name: string;
    description?: string;
    metric: string;
    groupBy?: string[];
    filters?: Record<string, unknown>;
    dateRange?: { from: string; to: string };
    visualization?: string;
    formula?: string;
    isTemplate?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, metric, groupBy, filters, dateRange, visualization, formula, isTemplate } = parsed.data;
  if (!name?.trim() || !metric?.trim()) {
    return NextResponse.json({ error: 'name and metric are required' }, { status: 400 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      const [row] = await db.insert(schema.reports).values({
        workspaceId: auth.user.workspaceId,
        createdBy: auth.user.id,
        name,
        description: description ?? null,
        metric,
        groupBy: groupBy ?? [],
        filters: filters ?? {},
        dateRange: dateRange ?? null,
        visualization: visualization ?? 'bar',
        formula: formula ?? null,
        isTemplate: isTemplate ?? false,
      }).returning();

      return NextResponse.json({ report: row }, { status: 201 });
    }

    return NextResponse.json({
      report: {
        id: crypto.randomUUID(),
        name, metric, groupBy: groupBy ?? [], filters: filters ?? {},
        visualization: visualization ?? 'bar', isTemplate: false,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create report' },
      { status: 500 },
    );
  }
}
