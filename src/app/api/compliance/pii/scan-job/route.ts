import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requirePerm } from '@/lib/rbac';
import { parseJsonBody, safeErrorMessage } from '@/lib/parse-json-body';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { enqueuePiiScan } from '@/lib/queue/dispatch';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, 'admin:settings', 'admin');
  if ('error' in auth) return auth.error;

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return parsed.error;

  try {
    const { entityTypes, workspaceId } = parsed.data;

    if (!entityTypes || !Array.isArray(entityTypes) || entityTypes.length === 0) {
      return NextResponse.json(
        { error: 'entityTypes must be a non-empty array of strings' },
        { status: 400 },
      );
    }

    const wsId = workspaceId || auth.user.workspaceId;
    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 },
      );
    }

    // Create the scan job record
    const [job] = await db
      .insert(schema.piiScanJobs)
      .values({
        workspaceId: wsId,
        startedBy: auth.user.id,
        entityTypes,
        status: 'queued',
      })
      .returning();

    // Enqueue a scan task for each entity type
    for (const entityType of entityTypes) {
      await enqueuePiiScan({
        scanJobId: job.id,
        entityType,
        batchSize: 100,
        workspaceId: wsId,
      });
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
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to start PII scan job') },
      { status: 500 },
    );
  }
}
