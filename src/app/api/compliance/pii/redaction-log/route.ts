import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ entries: [] });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);

    const rows = await db
      .select()
      .from(schema.piiRedactionLog)
      .where(eq(schema.piiRedactionLog.workspaceId, auth.user.workspaceId))
      .orderBy(desc(schema.piiRedactionLog.createdAt))
      .limit(limit);

    return NextResponse.json({
      entries: rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        detectionId: r.detectionId,
        entityType: r.entityType,
        entityId: r.entityId,
        fieldName: r.fieldName,
        originalHash: r.originalHash,
        maskedValue: r.maskedValue,
        redactedBy: r.redactedBy,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch redaction log' },
      { status: 500 },
    );
  }
}
