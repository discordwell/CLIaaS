import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:read');
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
