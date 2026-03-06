import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'reports:read');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [dashboard] = await db
        .select()
        .from(schema.dashboards)
        .where(and(
          eq(schema.dashboards.id, id),
          eq(schema.dashboards.workspaceId, auth.user.workspaceId),
        ))
        .limit(1);

      if (!dashboard) {
        return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
      }

      const widgets = await db
        .select()
        .from(schema.dashboardWidgets)
        .where(eq(schema.dashboardWidgets.dashboardId, id));

      return NextResponse.json({ dashboard, widgets });
    }

    return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get dashboard' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody<{
    name?: string;
    description?: string | null;
    layout?: Record<string, unknown>;
    isDefault?: boolean;
    enableSharing?: boolean;
    widgets?: Array<{
      id?: string;
      reportId: string;
      gridX: number;
      gridY: number;
      gridW: number;
      gridH: number;
      overrides?: Record<string, unknown>;
    }>;
  }>(request);
  if ('error' in parsed) return parsed.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      // Update dashboard fields
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const d = parsed.data;
      if (d.name !== undefined) updates.name = d.name;
      if (d.description !== undefined) updates.description = d.description;
      if (d.layout !== undefined) updates.layout = d.layout;
      if (d.isDefault !== undefined) updates.isDefault = d.isDefault;
      if (d.enableSharing !== undefined) {
        updates.shareToken = d.enableSharing ? crypto.randomUUID() : null;
      }

      const [row] = await db
        .update(schema.dashboards)
        .set(updates)
        .where(and(
          eq(schema.dashboards.id, id),
          eq(schema.dashboards.workspaceId, auth.user.workspaceId),
        ))
        .returning();

      if (!row) {
        return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
      }

      // If widgets array provided, replace all widgets in a transaction
      if (d.widgets !== undefined) {
        await db.transaction(async (tx) => {
          await tx
            .delete(schema.dashboardWidgets)
            .where(eq(schema.dashboardWidgets.dashboardId, id));

          if (d.widgets!.length > 0) {
            await tx.insert(schema.dashboardWidgets).values(
              d.widgets!.map((w) => ({
                dashboardId: id,
                reportId: w.reportId,
                gridX: w.gridX,
                gridY: w.gridY,
                gridW: w.gridW,
                gridH: w.gridH,
                overrides: w.overrides ?? {},
              })),
            );
          }
        });

        const widgets = await db
          .select()
          .from(schema.dashboardWidgets)
          .where(eq(schema.dashboardWidgets.dashboardId, id));

        return NextResponse.json({ dashboard: row, widgets });
      }

      return NextResponse.json({ dashboard: row });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update dashboard' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireScope(request, 'reports:write');
  if ('error' in auth) return auth.error;
  const { id } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      const [deleted] = await db
        .delete(schema.dashboards)
        .where(and(
          eq(schema.dashboards.id, id),
          eq(schema.dashboards.workspaceId, auth.user.workspaceId),
        ))
        .returning({ id: schema.dashboards.id });

      if (!deleted) {
        return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
      }

      return NextResponse.json({ deleted: true, id });
    }

    return NextResponse.json({ error: 'Not supported in JSONL mode' }, { status: 501 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete dashboard' },
      { status: 500 },
    );
  }
}
