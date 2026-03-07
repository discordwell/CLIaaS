import { safeErrorMessage } from '@/lib/parse-json-body';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { executeViewQuery } from '@/lib/views/executor';
import { loadTickets } from '@/lib/data';
import type { ViewQuery } from '@/lib/views/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;
  const page = parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(request.nextUrl.searchParams.get('pageSize') ?? '50', 10), 200);

  try {
    // Get view
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
    const filtered = executeViewQuery(query, tickets, authResult.user.id);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return NextResponse.json({
      tickets: paginated,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to execute view') },
      { status: 500 },
    );
  }
}
