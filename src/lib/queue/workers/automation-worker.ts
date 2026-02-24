/**
 * BullMQ worker: processes automation scheduler ticks.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type AutomationSchedulerJob } from '../types';
import { runSchedulerTick } from '../../automation/scheduler';
import { createLogger } from '../../logger';

const logger = createLogger('queue:automation-worker');

export function createAutomationWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<AutomationSchedulerJob>(
    QUEUE_NAMES.AUTOMATION_SCHEDULER,
    async (job: Job<AutomationSchedulerJob>) => {
      const matched = await runSchedulerTick();
      return { tick: job.data.tick, matched };
    },
    {
      ...opts,
      concurrency: 1,
    },
  );

  worker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, tick: job.data.tick, matched: result?.matched }, 'Automation tick completed');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, error: err.message }, 'Automation tick failed');
  });

  return worker;
}
