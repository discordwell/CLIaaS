import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ status: 'ok' });
  }

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and } = await import('drizzle-orm');

    const userId = authResult.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, userId),
        ),
      );

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark notification read' },
      { status: 500 },
    );
  }
}
