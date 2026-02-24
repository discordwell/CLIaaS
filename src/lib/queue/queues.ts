/**
 * Named BullMQ queues — returns null per queue when Redis is unavailable.
 */

import { Queue } from 'bullmq';
import { getRedisConnectionOpts, isRedisAvailable } from './connection';
import { QUEUE_NAMES, type QueueName } from './types';

const queueCache = new Map<QueueName, Queue>();

/** Get or create a BullMQ Queue instance. Returns null if Redis unavailable. */
export function getQueue(name: QueueName): Queue | null {
  if (!isRedisAvailable()) return null;

  if (queueCache.has(name)) return queueCache.get(name)!;

  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const queue = new Queue(name, opts);
  queueCache.set(name, queue);
  return queue;
}

/** Close all cached queue connections. */
export async function closeAllQueues(): Promise<void> {
  const promises = Array.from(queueCache.values()).map(q => q.close());
  await Promise.allSettled(promises);
  queueCache.clear();
}

/** Convenience accessors */
export function getWebhookQueue() { return getQueue(QUEUE_NAMES.WEBHOOK_DELIVERY); }
export function getAutomationQueue() { return getQueue(QUEUE_NAMES.AUTOMATION_SCHEDULER); }
export function getAIResolutionQueue() { return getQueue(QUEUE_NAMES.AI_RESOLUTION); }
export function getEmailQueue() { return getQueue(QUEUE_NAMES.EMAIL_SEND); }
