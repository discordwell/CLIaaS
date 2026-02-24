/**
 * BullMQ worker: processes webhook delivery jobs.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type WebhookDeliveryJob } from '../types';
import { deliverWebhook } from './webhook-processor';
import { createLogger } from '../../logger';

const logger = createLogger('queue:webhook-worker');

export function createWebhookWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<WebhookDeliveryJob>(
    QUEUE_NAMES.WEBHOOK_DELIVERY,
    async (job: Job<WebhookDeliveryJob>) => {
      const result = await deliverWebhook(job.data, job.attemptsMade + 1);
      if (!result.success) {
        throw new Error(result.error || 'Webhook delivery failed');
      }
      return result;
    },
    {
      ...opts,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, webhookId: job.data.webhookId }, 'Webhook delivered');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, webhookId: job?.data.webhookId, error: err.message }, 'Webhook delivery failed');
  });

  return worker;
}
