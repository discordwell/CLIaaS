/**
 * Automation scheduler: periodically evaluates time-based automation rules
 * (type='automation') against all active tickets. Uses BullMQ repeatable job
 * when Redis is available, falls back to setInterval.
 */

import { getAutomationRules, executeRules } from './executor';
import type { TicketContext } from './engine';
import { getAutomationQueue } from '../queue/queues';
import { isRedisAvailable } from '../queue/connection';
import { createLogger } from '../logger';
import * as Sentry from '@sentry/nextjs';

const logger = createLogger('automation:scheduler');

export interface SchedulerConfig {
  tickIntervalMs: number; // default: 60_000 (1 minute)
  getActiveTickets: () => Promise<TicketContext[]>;
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerConfig: SchedulerConfig | null = null;
let usingBullMQ = false;

export function startScheduler(config: SchedulerConfig): void {
  if (schedulerTimer || usingBullMQ) stopScheduler();

  schedulerConfig = config;

  // Try BullMQ repeatable job first
  if (isRedisAvailable()) {
    const queue = getAutomationQueue();
    if (queue) {
      void queue.add(
        'scheduler-tick',
        { tick: 0, scheduledAt: new Date().toISOString() },
        {
          repeat: { every: config.tickIntervalMs },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      ).then(() => {
        usingBullMQ = true;
        logger.info({ intervalMs: config.tickIntervalMs }, 'Automation scheduler started (BullMQ)');
      }).catch(() => {
        // Fallback to setInterval
        startFallbackTimer(config);
      });
      return;
    }
  }

  startFallbackTimer(config);
}

function startFallbackTimer(config: SchedulerConfig): void {
  schedulerTimer = setInterval(() => {
    void runSchedulerTick();
  }, config.tickIntervalMs);
  logger.info({ intervalMs: config.tickIntervalMs }, 'Automation scheduler started (setInterval fallback)');
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (usingBullMQ) {
    const queue = getAutomationQueue();
    if (queue) {
      void queue.removeRepeatable('scheduler-tick', { every: schedulerConfig?.tickIntervalMs ?? 60_000 }).catch(() => {});
    }
    usingBullMQ = false;
  }
  schedulerConfig = null;
}

export function isSchedulerRunning(): boolean {
  return schedulerTimer !== null || usingBullMQ;
}

export async function runSchedulerTick(): Promise<number> {
  if (!schedulerConfig) return 0;

  const rules = getAutomationRules().filter(r => r.type === 'automation' && r.enabled);
  if (rules.length === 0) return 0;

  let totalMatched = 0;

  try {
    const tickets = await schedulerConfig.getActiveTickets();
    const now = Date.now();

    for (const ticket of tickets) {
      // Enrich with time-based fields
      const enriched: TicketContext = {
        ...ticket,
        hoursSinceCreated: (now - new Date(ticket.createdAt).getTime()) / 3_600_000,
        hoursSinceUpdated: (now - new Date(ticket.updatedAt).getTime()) / 3_600_000,
      };

      const results = executeRules({
        ticket: enriched,
        event: 'automation.tick',
        triggerType: 'automation',
      });

      totalMatched += results.filter(r => r.matched).length;
    }
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: 'scheduler-tick' } });
    logger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'Scheduler tick failed');
  }

  return totalMatched;
}
