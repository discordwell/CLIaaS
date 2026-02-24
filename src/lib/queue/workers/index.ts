/**
 * Worker registry — start/stop all BullMQ workers.
 */

import type { Worker } from 'bullmq';
import { isRedisAvailable } from '../connection';
import { createWebhookWorker } from './webhook-worker';
import { createAutomationWorker } from './automation-worker';
import { createAIResolutionWorker } from './ai-resolution-worker';
import { createEmailWorker } from './email-worker';
import { createLogger } from '../../logger';

const logger = createLogger('queue:workers');

const activeWorkers: Worker[] = [];

/** Start all BullMQ workers. No-op if Redis is unavailable. */
export function startAllWorkers(): void {
  if (!isRedisAvailable()) {
    logger.info('Redis not available — workers not started (inline fallback active)');
    return;
  }

  if (activeWorkers.length > 0) {
    logger.warn('Workers already running — skipping duplicate start');
    return;
  }

  const factories = [
    createWebhookWorker,
    createAutomationWorker,
    createAIResolutionWorker,
    createEmailWorker,
  ];

  for (const factory of factories) {
    const worker = factory();
    if (worker) activeWorkers.push(worker);
  }

  logger.info({ count: activeWorkers.length }, 'BullMQ workers started');
}

/** Gracefully stop all running workers. */
export async function stopAllWorkers(): Promise<void> {
  if (activeWorkers.length === 0) return;

  logger.info({ count: activeWorkers.length }, 'Stopping BullMQ workers');
  await Promise.allSettled(activeWorkers.map(w => w.close()));
  activeWorkers.length = 0;
}

/** Returns the number of currently active workers. */
export function getActiveWorkerCount(): number {
  return activeWorkers.length;
}
