import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  const authResult = await requirePerm(request, 'tickets:view');
  if ('error' in authResult) return authResult.error;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ status: 'ok', count: 0 });
  }

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and, isNull } = await import('drizzle-orm');

    const userId = authResult.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      )
      .returning({ id: schema.notifications.id });

    return NextResponse.json({ status: 'ok', count: result.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark all read' },
      { status: 500 },
    );
  }
}
