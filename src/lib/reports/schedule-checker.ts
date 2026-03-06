/**
 * Schedule checker — finds due report schedules and enqueues export jobs.
 *
 * Meant to be called periodically (e.g., from a cron job or interval timer).
 * DB-first with in-memory fallback.
 */

import { createLogger } from '../logger';
import { enqueueReportExport } from '../queue/dispatch';

const logger = createLogger('reports:schedule-checker');

/** In-memory schedule store (fallback when no DB) */
interface MemorySchedule {
  id: string;
  reportId: string;
  frequency: string;
  hourUtc: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  format: string;
  recipients: string[];
  enabled: boolean;
  lastSentAt: string | null;
  nextRunAt: string | null;
}

const memorySchedules = new Map<string, MemorySchedule>();

/** Register a schedule in the in-memory store (used when DB unavailable) */
export function registerMemorySchedule(schedule: MemorySchedule): void {
  memorySchedules.set(schedule.id, schedule);
}

function computeNextRun(frequency: string, hourUtc: number, dayOfWeek?: number, dayOfMonth?: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hourUtc);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 1);
      if (dayOfWeek !== undefined) {
        while (next.getUTCDay() !== dayOfWeek) next.setUTCDate(next.getUTCDate() + 1);
      } else {
        next.setUTCDate(next.getUTCDate() + 7);
      }
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (dayOfMonth !== undefined) next.setUTCDate(dayOfMonth);
      break;
    default:
      next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

/**
 * Check for due schedules and enqueue export jobs.
 * Returns the number of jobs enqueued.
 */
export async function checkSchedules(): Promise<number> {
  const now = new Date();
  let enqueued = 0;

  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and, lte } = await import('drizzle-orm');

      // Find all enabled schedules where nextRunAt <= now
      const dueSchedules = await db.select().from(schema.reportSchedules)
        .where(and(
          eq(schema.reportSchedules.enabled, true),
          lte(schema.reportSchedules.nextRunAt, now),
        ));

      for (const schedule of dueSchedules) {
        const success = await enqueueReportExport({
          scheduleId: schedule.id,
          reportId: schedule.reportId,
          format: (schedule.format as 'csv' | 'json') ?? 'csv',
          recipients: schedule.recipients,
        });

        if (success) {
          // Update lastSentAt and compute next run
          const nextRunAt = computeNextRun(
            schedule.frequency,
            schedule.hourUtc,
            schedule.dayOfWeek ?? undefined,
            schedule.dayOfMonth ?? undefined,
          );

          await db.update(schema.reportSchedules)
            .set({ lastSentAt: now, nextRunAt, updatedAt: now })
            .where(eq(schema.reportSchedules.id, schedule.id));

          enqueued++;
          logger.info({ scheduleId: schedule.id, nextRunAt }, 'Schedule enqueued, next run updated');
        } else {
          logger.warn({ scheduleId: schedule.id }, 'Failed to enqueue report export (Redis unavailable?)');
        }
      }

      return enqueued;
    }

    // In-memory fallback
    for (const schedule of memorySchedules.values()) {
      if (!schedule.enabled) continue;
      if (!schedule.nextRunAt || new Date(schedule.nextRunAt) > now) continue;

      const success = await enqueueReportExport({
        scheduleId: schedule.id,
        reportId: schedule.reportId,
        format: (schedule.format as 'csv' | 'json') ?? 'csv',
        recipients: schedule.recipients,
      });

      if (success) {
        const nextRunAt = computeNextRun(
          schedule.frequency,
          schedule.hourUtc,
          schedule.dayOfWeek,
          schedule.dayOfMonth,
        );
        schedule.lastSentAt = now.toISOString();
        schedule.nextRunAt = nextRunAt.toISOString();
        enqueued++;
        logger.info({ scheduleId: schedule.id }, 'Memory schedule enqueued');
      }
    }

    return enqueued;
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Schedule check failed');
    return enqueued;
  }
}
