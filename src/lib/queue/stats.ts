/**
 * Queue statistics — waiting/active/completed/failed counts per queue.
 */

import { getQueue } from './queues';
import { QUEUE_NAMES, type QueueName } from './types';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/** Get stats for a single queue. Returns null if Redis unavailable. */
export async function getQueueStats(name: QueueName): Promise<QueueStats | null> {
  const queue = getQueue(name);
  if (!queue) return null;

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { name, waiting, active, completed, failed, delayed };
  } catch {
    return null;
  }
}

/** Get stats for all queues. Returns empty array if Redis unavailable. */
export async function getAllQueueStats(): Promise<QueueStats[]> {
  const names = Object.values(QUEUE_NAMES);
  const results = await Promise.all(names.map(n => getQueueStats(n)));
  return results.filter((r): r is QueueStats => r !== null);
}
