import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');

      const [dashboard] = await db
        .select()
        .from(schema.dashboards)
        .where(eq(schema.dashboards.shareToken, token))
        .limit(1);

      if (!dashboard) {
        return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
      }

      const widgets = await db
        .select()
        .from(schema.dashboardWidgets)
        .where(eq(schema.dashboardWidgets.dashboardId, dashboard.id));

      return NextResponse.json({ dashboard, widgets });
    }

    return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shared dashboard' },
      { status: 500 },
    );
  }
}
