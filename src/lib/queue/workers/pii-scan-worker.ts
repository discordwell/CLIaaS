/**
 * BullMQ worker for PII scan jobs.
 * Processes single-entity scans and retroactive batch scans.
 */

import { Worker, type Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type PiiScanJob } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('worker:pii-scan');

async function processPiiScan(job: Job<PiiScanJob>): Promise<void> {
  const { entityType, entityId, workspaceId, scanJobId, batchOffset, batchSize } = job.data;

  // Lazy import to avoid circular dependencies
  const { scanEntity } = await import('@/lib/compliance/pii-masking');

  if (entityId) {
    // Single entity scan
    const detections = await scanEntity(entityType, entityId, workspaceId);
    logger.info({ entityType, entityId, detections: detections.length }, 'PII scan complete');
    return;
  }

  // Retroactive batch scan
  if (scanJobId) {
    const { getDb } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, sql } = await import('drizzle-orm');
    const db = getDb();
    if (!db) return;

    try {
      // Update job status to running
      await db
        .update(schema.piiScanJobs)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(schema.piiScanJobs.id, scanJobId));

      const offset = batchOffset ?? 0;

      let rows: { id: string }[] = [];
      switch (entityType) {
        case 'message':
          rows = await db
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(eq(schema.messages.workspaceId, workspaceId))
            .limit(batchSize)
            .offset(offset);
          break;
        case 'ticket':
          rows = await db
            .select({ id: schema.tickets.id })
            .from(schema.tickets)
            .where(eq(schema.tickets.workspaceId, workspaceId))
            .limit(batchSize)
            .offset(offset);
          break;
        case 'customer':
          rows = await db
            .select({ id: schema.customers.id })
            .from(schema.customers)
            .where(eq(schema.customers.workspaceId, workspaceId))
            .limit(batchSize)
            .offset(offset);
          break;
      }

      let detectionsFound = 0;
      for (const row of rows) {
        const detections = await scanEntity(entityType, row.id, workspaceId);
        detectionsFound += detections.length;
      }

      // Update progress
      await db
        .update(schema.piiScanJobs)
        .set({
          scannedRecords: sql`${schema.piiScanJobs.scannedRecords} + ${rows.length}`,
          detectionsFound: sql`${schema.piiScanJobs.detectionsFound} + ${detectionsFound}`,
          ...(rows.length < batchSize
            ? { status: 'completed', completedAt: new Date() }
            : {}),
        })
        .where(eq(schema.piiScanJobs.id, scanJobId));

      // If more records to scan, enqueue next batch
      if (rows.length === batchSize) {
        const { enqueuePiiScan } = await import('../dispatch');
        await enqueuePiiScan({
          scanJobId,
          entityType,
          batchOffset: offset + batchSize,
          batchSize,
          workspaceId,
        });
      }

      logger.info({ scanJobId, entityType, scanned: rows.length, detections: detectionsFound }, 'PII batch scan progress');
    } catch (err) {
      await db
        .update(schema.piiScanJobs)
        .set({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' })
        .where(eq(schema.piiScanJobs.id, scanJobId));
      throw err;
    }
  }
}

export function startPiiScanWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker(QUEUE_NAMES.PII_SCAN, processPiiScan, {
    ...opts,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'PII scan job failed');
  });

  return worker;
}
