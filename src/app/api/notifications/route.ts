import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireScope } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await requireScope(request, 'tickets:read');
  if ('error' in authResult) return authResult.error;

  const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true';
  const userId = authResult.user?.id;

  if (!userId || !process.env.DATABASE_URL) {
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, and, isNull, desc } = await import('drizzle-orm');

    const conditions = [eq(schema.notifications.userId, userId)];
    if (unreadOnly) {
      conditions.push(isNull(schema.notifications.readAt));
    }

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(and(...conditions))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50);

    // Count unread
    const unreadRows = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      );

    return NextResponse.json({
      notifications: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        read: !!r.readAt,
        createdAt: r.createdAt.toISOString(),
      })),
      unreadCount: unreadRows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load notifications' },
      { status: 500 },
    );
  }
}
