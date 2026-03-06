import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 },
      );
    }

    const [job] = await db
      .select()
      .from(schema.piiScanJobs)
      .where(
        and(
          eq(schema.piiScanJobs.id, id),
          eq(schema.piiScanJobs.workspaceId, auth.user.workspaceId),
        ),
      )
      .limit(1);

    if (!job) {
      return NextResponse.json(
        { error: 'Scan job not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      job: {
        id: job.id,
        workspaceId: job.workspaceId,
        startedBy: job.startedBy,
        entityTypes: job.entityTypes,
        status: job.status,
        totalRecords: job.totalRecords,
        scannedRecords: job.scannedRecords,
        detectionsFound: job.detectionsFound,
        error: job.error,
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get scan job' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, 'admin');
  if ('error' in auth) return auth.error;

  const { id } = await params;

  try {
    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 },
      );
    }

    const result = await db
      .update(schema.piiScanJobs)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(
        and(
          eq(schema.piiScanJobs.id, id),
          eq(schema.piiScanJobs.workspaceId, auth.user.workspaceId),
        ),
      )
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Scan job not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel scan job' },
      { status: 500 },
    );
  }
}
