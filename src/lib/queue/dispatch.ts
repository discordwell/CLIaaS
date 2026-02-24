/**
 * enqueue*() helpers — try Redis, return false to signal caller should fallback to inline.
 */

import { getWebhookQueue, getEmailQueue, getAIResolutionQueue, getAutomationQueue } from './queues';
import type {
  WebhookDeliveryJob,
  EmailSendJob,
  AIResolutionJob,
  AutomationSchedulerJob,
} from './types';

/**
 * Enqueue a webhook delivery job. Returns true if enqueued, false if caller should fallback.
 */
export async function enqueueWebhookDelivery(job: WebhookDeliveryJob): Promise<boolean> {
  const queue = getWebhookQueue();
  if (!queue) return false;

  try {
    await queue.add('deliver', job, {
      attempts: job.retryPolicy.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enqueue an email send job. Returns true if enqueued, false if caller should fallback.
 */
export async function enqueueEmailSend(job: EmailSendJob): Promise<boolean> {
  const queue = getEmailQueue();
  if (!queue) return false;

  try {
    await queue.add('send', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enqueue an AI resolution job. Returns true if enqueued, false if caller should fallback.
 */
export async function enqueueAIResolution(job: AIResolutionJob): Promise<boolean> {
  const queue = getAIResolutionQueue();
  if (!queue) return false;

  try {
    await queue.add('resolve', job, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enqueue an automation scheduler tick. Returns true if enqueued, false if caller should fallback.
 */
export async function enqueueAutomationTick(job: AutomationSchedulerJob): Promise<boolean> {
  const queue = getAutomationQueue();
  if (!queue) return false;

  try {
    await queue.add('tick', job, {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });
    return true;
  } catch {
    return false;
  }
}
