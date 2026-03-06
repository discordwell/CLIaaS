import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const q = request.nextUrl.searchParams.get('q') ?? '';

  try {
    const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers');
    const conn = await tryDb();
    if (!conn) return NextResponse.json({ tags: [] });

    const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
    const { eq, and, ilike } = await import('drizzle-orm');

    const conditions = [eq(conn.schema.tags.workspaceId, wsId)];
    if (q.trim()) {
      conditions.push(ilike(conn.schema.tags.name, `${q.trim()}%`));
    }

    const rows = await conn.db
      .select({
        id: conn.schema.tags.id,
        name: conn.schema.tags.name,
        color: conn.schema.tags.color,
      })
      .from(conn.schema.tags)
      .where(and(...conditions))
      .orderBy(conn.schema.tags.name)
      .limit(20);

    return NextResponse.json({ tags: rows });
  } catch {
    return NextResponse.json({ tags: [] });
  }
}
