import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';

export const dynamic = 'force-dynamic';

// In-memory fallback store for when DATABASE_URL is not set
const memoryStore: Array<{
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  layout: Record<string, unknown>;
  shareToken: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  widgetCount: number;
}> = [];

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, desc, sql } = await import('drizzle-orm');

      const rows = await db
        .select({
          id: schema.dashboards.id,
          workspaceId: schema.dashboards.workspaceId,
          name: schema.dashboards.name,
          description: schema.dashboards.description,
          isDefault: schema.dashboards.isDefault,
          layout: schema.dashboards.layout,
          shareToken: schema.dashboards.shareToken,
          createdBy: schema.dashboards.createdBy,
          createdAt: schema.dashboards.createdAt,
          updatedAt: schema.dashboards.updatedAt,
          widgetCount: sql<number>`(SELECT count(*) FROM dashboard_widgets WHERE dashboard_id = ${schema.dashboards.id})`.as('widget_count'),
        })
        .from(schema.dashboards)
        .where(eq(schema.dashboards.workspaceId, auth.user.workspaceId))
        .orderBy(desc(schema.dashboards.updatedAt));

      return NextResponse.json({ dashboards: rows });
    }

    // In-memory fallback
    const filtered = memoryStore.filter((d) => d.workspaceId === auth.user.workspaceId);
    return NextResponse.json({ dashboards: filtered });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list dashboards') },
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
    layout?: Record<string, unknown>;
    isDefault?: boolean;
  }>(request);
  if ('error' in parsed) return parsed.error;

  const { name, description, layout, isDefault } = parsed.data;
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');

      const [row] = await db.insert(schema.dashboards).values({
        workspaceId: auth.user.workspaceId,
        createdBy: auth.user.id,
        name,
        description: description ?? null,
        layout: layout ?? {},
        isDefault: isDefault ?? false,
        shareToken: null,
      }).returning();

      return NextResponse.json({ dashboard: { ...row, widgetCount: 0 } }, { status: 201 });
    }

    // In-memory fallback
    const newDashboard = {
      id: crypto.randomUUID(),
      workspaceId: auth.user.workspaceId,
      name,
      description: description ?? null,
      isDefault: isDefault ?? false,
      layout: layout ?? {},
      shareToken: null,
      createdBy: auth.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      widgetCount: 0,
    };
    memoryStore.push(newDashboard);
    return NextResponse.json({ dashboard: newDashboard }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create dashboard') },
      { status: 500 },
    );
  }
}
