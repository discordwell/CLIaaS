import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ accessLog: [] });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);

    const rows = await db
      .select()
      .from(schema.piiAccessLog)
      .where(eq(schema.piiAccessLog.workspaceId, auth.user.workspaceId))
      .limit(limit)
      .orderBy(schema.piiAccessLog.createdAt);

    return NextResponse.json({
      accessLog: rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        userId: r.userId,
        entityType: r.entityType,
        entityId: r.entityId,
        fieldName: r.fieldName,
        piiType: r.piiType,
        accessType: r.accessType,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch PII access log' },
      { status: 500 },
    );
  }
}
