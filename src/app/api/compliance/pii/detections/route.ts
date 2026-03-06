import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ detections: [] });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const piiType = url.searchParams.get('piiType');
    const entityType = url.searchParams.get('entityType');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);

    const conditions = [eq(schema.piiDetections.workspaceId, auth.user.workspaceId)];

    if (status) {
      conditions.push(eq(schema.piiDetections.status, status as typeof schema.piiDetections.status.enumValues[number]));
    }
    if (piiType) {
      conditions.push(eq(schema.piiDetections.piiType, piiType as typeof schema.piiDetections.piiType.enumValues[number]));
    }
    if (entityType) {
      conditions.push(eq(schema.piiDetections.entityType, entityType));
    }

    const detections = await db
      .select()
      .from(schema.piiDetections)
      .where(and(...conditions))
      .limit(limit)
      .orderBy(schema.piiDetections.createdAt);

    return NextResponse.json({
      detections: detections.map(d => ({
        id: d.id,
        workspaceId: d.workspaceId,
        entityType: d.entityType,
        entityId: d.entityId,
        fieldName: d.fieldName,
        piiType: d.piiType,
        charOffset: d.charOffset,
        charLength: d.charLength,
        maskedValue: d.maskedValue,
        confidence: d.confidence,
        detectionMethod: d.detectionMethod,
        status: d.status,
        reviewedBy: d.reviewedBy,
        reviewedAt: d.reviewedAt?.toISOString() ?? null,
        redactedAt: d.redactedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list PII detections' },
      { status: 500 },
    );
  }
}
