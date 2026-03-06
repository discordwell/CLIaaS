import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:view');
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
    const { or, ilike, eq, and } = await import('drizzle-orm');

    const workspaceId = authResult.user?.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ users: [] });
    }

    // Escape ILIKE wildcards in user input
    const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escapeLike(q)}%`;

    const filtered = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.workspaceId, workspaceId),
          or(
            ilike(schema.users.name, pattern),
            ilike(schema.users.email, pattern),
          ),
        ),
      )
      .limit(10);

    return NextResponse.json({ users: filtered });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'User search failed' },
      { status: 500 },
    );
  }
}
