/**
 * BullMQ worker: processes AI resolution jobs.
 * Placeholder — calls into the AI resolution pipeline when available.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type AIResolutionJob } from '../types';
import { createLogger } from '../../logger';

const logger = createLogger('queue:ai-resolution-worker');

export function createAIResolutionWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<AIResolutionJob>(
    QUEUE_NAMES.AI_RESOLUTION,
    async (job: Job<AIResolutionJob>) => {
      logger.info({ ticketId: job.data.ticketId, event: job.data.event }, 'AI resolution job received');
      // AI resolution pipeline integration point — currently a no-op.
      // When the AI agent module is built, wire it here.
      return { ticketId: job.data.ticketId, status: 'skipped' };
    },
    {
      ...opts,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, ticketId: job.data.ticketId }, 'AI resolution completed');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, ticketId: job?.data.ticketId, error: err.message }, 'AI resolution failed');
  });

  return worker;
}
