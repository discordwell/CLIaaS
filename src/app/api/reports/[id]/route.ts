import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'analytics:read');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [row] = await db.select().from(schema.reports)
        .where(and(eq(schema.reports.id, id), eq(schema.reports.workspaceId, auth.user.workspaceId)))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      return NextResponse.json({ report: row });
    }

    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get report' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'analytics:read');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string;
    metric?: string;
    groupBy?: string[];
    filters?: Record<string, unknown>;
    dateRange?: { from: string; to: string } | null;
    visualization?: string;
    formula?: string | null;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const d = parsed.data;
      if (d.name !== undefined) updates.name = d.name;
      if (d.description !== undefined) updates.description = d.description;
      if (d.metric !== undefined) updates.metric = d.metric;
      if (d.groupBy !== undefined) updates.groupBy = d.groupBy;
      if (d.filters !== undefined) updates.filters = d.filters;
      if (d.dateRange !== undefined) updates.dateRange = d.dateRange;
      if (d.visualization !== undefined) updates.visualization = d.visualization;
      if (d.formula !== undefined) updates.formula = d.formula;

      const [row] = await db.update(schema.reports)
        .set(updates)
        .where(and(eq(schema.reports.id, id), eq(schema.reports.workspaceId, auth.user.workspaceId)))
        .returning();

      if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      return NextResponse.json({ report: row });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update report' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'analytics:read');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [deleted] = await db.delete(schema.reports)
        .where(and(eq(schema.reports.id, id), eq(schema.reports.workspaceId, auth.user.workspaceId)))
        .returning({ id: schema.reports.id });

      if (!deleted) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      return NextResponse.json({ deleted: true, id });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete report' },
      { status: 500 },
    );
  }
}
