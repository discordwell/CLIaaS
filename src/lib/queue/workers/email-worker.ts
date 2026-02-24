/**
 * BullMQ worker: processes email send jobs.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type EmailSendJob } from '../types';
import { sendEmail } from '../../email/sender';
import { createLogger } from '../../logger';

const logger = createLogger('queue:email-worker');

export function createEmailWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<EmailSendJob>(
    QUEUE_NAMES.EMAIL_SEND,
    async (job: Job<EmailSendJob>) => {
      // Pass _skipQueue=true to avoid re-enqueueing from the worker
      const result = await sendEmail(job.data, true);
      if (!result.success) {
        throw new Error(result.error || 'Email send failed');
      }
      return result;
    },
    {
      ...opts,
      concurrency: 3,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, to: job.data.to }, 'Email sent');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, to: job?.data.to, error: err.message }, 'Email send failed');
  });

  return worker;
}
