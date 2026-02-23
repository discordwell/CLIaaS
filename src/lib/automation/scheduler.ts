/**
 * Automation scheduler: periodically evaluates time-based automation rules
 * (type='automation') against all active tickets. Uses setInterval with
 * a configurable tick interval.
 */

import { getAutomationRules, executeRules } from './executor';
import type { TicketContext } from './engine';

export interface SchedulerConfig {
  tickIntervalMs: number; // default: 60_000 (1 minute)
  getActiveTickets: () => Promise<TicketContext[]>;
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerConfig: SchedulerConfig | null = null;

export function startScheduler(config: SchedulerConfig): void {
  if (schedulerTimer) stopScheduler();

  schedulerConfig = config;
  schedulerTimer = setInterval(() => {
    void runSchedulerTick();
  }, config.tickIntervalMs);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerConfig = null;
}

export function isSchedulerRunning(): boolean {
  return schedulerTimer !== null;
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
  } catch {
    // Swallow errors to keep scheduler running
  }

  return totalMatched;
}
