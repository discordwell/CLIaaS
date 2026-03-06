import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody } from '@/lib/parse-json-body';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json({ records: [] });
    }

    const records = await db
      .select()
      .from(schema.hipaaBaaRecords)
      .where(eq(schema.hipaaBaaRecords.workspaceId, auth.user.workspaceId))
      .orderBy(schema.hipaaBaaRecords.createdAt);

    return NextResponse.json({
      records: records.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        partnerName: r.partnerName,
        partnerEmail: r.partnerEmail,
        signedAt: r.signedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        documentUrl: r.documentUrl,
        documentHash: r.documentHash,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list BAA records' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { partnerName, partnerEmail, signedAt, expiresAt, documentUrl, documentHash } = parsed.data;

    if (!partnerName || !partnerEmail) {
      return NextResponse.json(
        { error: 'partnerName and partnerEmail are required' },
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

    const [record] = await db
      .insert(schema.hipaaBaaRecords)
      .values({
        workspaceId: auth.user.workspaceId,
        partnerName,
        partnerEmail,
        signedAt: signedAt ? new Date(signedAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        documentUrl: documentUrl ?? null,
        documentHash: documentHash ?? null,
        status: signedAt ? 'active' : 'pending',
      })
      .returning();

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
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create BAA record' },
      { status: 500 },
    );
  }
}
