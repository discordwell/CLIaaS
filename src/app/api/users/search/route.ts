import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (!q.trim()) {
    return NextResponse.json({ users: [] });
  }

  if (!process.env.DATABASE_URL) {
    // Demo mode — return mock users
    return NextResponse.json({
      users: [
        { id: 'demo-user', name: 'Demo Agent', email: 'demo@cliaas.local' },
      ].filter((u) =>
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        u.email.toLowerCase().includes(q.toLowerCase())
      ),
    });
  }

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { or, ilike, eq } = await import('drizzle-orm');

    const workspaceId = authResult.user?.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ users: [] });
    }

    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(
        eq(schema.users.workspaceId, workspaceId),
      )
      .limit(100);

    // Filter by query in-app (ILIKE on both name and email)
    const lowerQ = q.toLowerCase();
    const filtered = rows
      .filter((r: { name: string; email: string | null }) =>
        r.name.toLowerCase().includes(lowerQ) ||
        (r.email && r.email.toLowerCase().includes(lowerQ))
      )
      .slice(0, 10)
      .map((r: { id: string; name: string; email: string | null }) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      }));

    return NextResponse.json({ users: filtered });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'User search failed' },
      { status: 500 },
    );
  }
}
