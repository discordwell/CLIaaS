import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';
import { executeViewQuery } from '@/lib/views/executor';
import { loadTickets } from '@/lib/data';
import type { ViewQuery } from '@/lib/views/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  try {
    let query: ViewQuery;

    const { tryDb } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq, and } = await import('drizzle-orm');
      const { getDefaultWorkspaceId } = await import('@/lib/store-helpers');
      const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
      const [row] = await conn.db
        .select({ query: conn.schema.views.query, viewType: conn.schema.views.viewType, userId: conn.schema.views.userId })
        .from(conn.schema.views)
        .where(and(eq(conn.schema.views.id, id), eq(conn.schema.views.workspaceId, wsId)))
        .limit(1);

      if (!row) return NextResponse.json({ error: 'View not found' }, { status: 404 });
      if (row.viewType === 'personal' && row.userId !== authResult.user.id) {
        return NextResponse.json({ error: 'View not found' }, { status: 404 });
      }
      query = row.query as ViewQuery;
    } else {
      const { getView } = await import('@/lib/views/store');
      const view = getView(id);
      if (!view) return NextResponse.json({ error: 'View not found' }, { status: 404 });
      query = view.query;
    }

    const tickets = await loadTickets();
    const count = executeViewQuery(query, tickets, authResult.user.id).length;

    return NextResponse.json({ count });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to count' },
      { status: 500 },
    );
  }
}
