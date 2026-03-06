import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  const { id } = await params;

  try {
    const { status } = parsed.data;

    if (!status || !['pending', 'active', 'expired', 'revoked'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be one of: pending, active, expired, revoked' },
        { status: 400 },
      );
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 },
      );
    }

    const result = await db
      .update(schema.hipaaBaaRecords)
      .set({ status })
      .where(
        and(
          eq(schema.hipaaBaaRecords.id, id),
          eq(schema.hipaaBaaRecords.workspaceId, auth.user.workspaceId),
        ),
      )
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'BAA record not found' },
        { status: 404 },
      );
    }

    const record = result[0];
    return NextResponse.json({
      record: {
        id: record.id,
        workspaceId: record.workspaceId,
        partnerName: record.partnerName,
        partnerEmail: record.partnerEmail,
        signedAt: record.signedAt?.toISOString() ?? null,
        expiresAt: record.expiresAt?.toISOString() ?? null,
        documentUrl: record.documentUrl,
        documentHash: record.documentHash,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update BAA record' },
      { status: 500 },
    );
  }
}
