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
  const page = parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(request.nextUrl.searchParams.get('pageSize') ?? '50', 10), 200);

  try {
    // Get view
    let query: ViewQuery;

    const { tryDb } = await import('@/lib/store-helpers');
    const conn = await tryDb();

    if (conn) {
      const { eq } = await import('drizzle-orm');
      const [row] = await conn.db
        .select({ query: conn.schema.views.query })
        .from(conn.schema.views)
        .where(eq(conn.schema.views.id, id))
        .limit(1);

      if (!row) return NextResponse.json({ error: 'View not found' }, { status: 404 });
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
      { error: err instanceof Error ? err.message : 'Failed to execute view' },
      { status: 500 },
    );
  }
}
