import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { checkSchedules, registerMemorySchedule } from '../schedule-checker';

// Mock the queue dispatch module
vi.mock('@/lib/queue/dispatch', () => ({
  enqueueReportExport: vi.fn().mockResolvedValue(true),
}));

// Ensure no DATABASE_URL so we use in-memory path
const originalEnv = process.env.DATABASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATABASE_URL;
});

afterAll(() => {
  if (originalEnv) process.env.DATABASE_URL = originalEnv;
});

import { enqueueReportExport } from '@/lib/queue/dispatch';

describe('schedule-checker', () => {
  it('enqueues jobs for due schedules', async () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();

    registerMemorySchedule({
      id: 'sched-1',
      reportId: 'report-1',
      frequency: 'daily',
      hourUtc: 9,
      format: 'csv',
      recipients: ['alice@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: pastDate,
    });

    const count = await checkSchedules();

    expect(count).toBe(1);
    expect(enqueueReportExport).toHaveBeenCalledWith({
      scheduleId: 'sched-1',
      reportId: 'report-1',
      format: 'csv',
      recipients: ['alice@test.com'],
    });
  });

  it('skips disabled schedules', async () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();

    registerMemorySchedule({
      id: 'sched-disabled',
      reportId: 'report-2',
      frequency: 'weekly',
      hourUtc: 9,
      format: 'json',
      recipients: ['bob@test.com'],
      enabled: false,
      lastSentAt: null,
      nextRunAt: pastDate,
    });

    const count = await checkSchedules();

    expect(count).toBe(0);
    expect(enqueueReportExport).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: 'sched-disabled' }),
    );
  });

  it('skips schedules not yet due', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    registerMemorySchedule({
      id: 'sched-future',
      reportId: 'report-3',
      frequency: 'monthly',
      hourUtc: 14,
      format: 'csv',
      recipients: ['carol@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: futureDate,
    });

    const count = await checkSchedules();

    expect(count).toBe(0);
    expect(enqueueReportExport).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: 'sched-future' }),
    );
  });

  it('updates nextRunAt after enqueuing', async () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();

    const schedule = {
      id: 'sched-update',
      reportId: 'report-4',
      frequency: 'daily',
      hourUtc: 12,
      format: 'csv' as const,
      recipients: ['dave@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: pastDate,
    };

    registerMemorySchedule(schedule);

    await checkSchedules();

    // nextRunAt should have been advanced to the future
    expect(schedule.nextRunAt).not.toBe(pastDate);
    expect(new Date(schedule.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(schedule.lastSentAt).not.toBeNull();
  });

  it('returns 0 when enqueue fails', async () => {
    vi.mocked(enqueueReportExport).mockResolvedValueOnce(false);

    const pastDate = new Date(Date.now() - 60000).toISOString();
    registerMemorySchedule({
      id: 'sched-fail',
      reportId: 'report-5',
      frequency: 'daily',
      hourUtc: 8,
      format: 'json',
      recipients: ['eve@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: pastDate,
    });

    const count = await checkSchedules();
    expect(count).toBe(0);
  });

  // Number of whole days between a computed nextRunAt and "today at hourUtc".
  // computeNextRun zeroes minutes/seconds and sets hourUtc, so this is exact.
  function daysUntil(nextRunAt: string, hourUtc: number): number {
    const base = new Date();
    base.setUTCMinutes(0, 0, 0);
    base.setUTCHours(hourUtc);
    return Math.round((new Date(nextRunAt).getTime() - base.getTime()) / 86400000);
  }

  it('advances a weekly schedule without dayOfWeek by exactly 7 days', async () => {
    const schedule = {
      id: 'sched-weekly-noday',
      reportId: 'report-w',
      frequency: 'weekly',
      hourUtc: 9,
      // dayOfWeek intentionally omitted
      format: 'csv' as const,
      recipients: ['frank@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: new Date(Date.now() - 60000).toISOString(),
    };
    registerMemorySchedule(schedule);

    await checkSchedules();

    // Regression: the initial "+1 (skip today)" used to combine with "+7",
    // scheduling the next run 8 days out and drifting the weekday each cycle.
    expect(daysUntil(schedule.nextRunAt!, 9)).toBe(7);
  });

  it('advances a weekly schedule with dayOfWeek to the next matching weekday', async () => {
    const today = new Date().getUTCDay();
    const targetDay = (today + 2) % 7; // 2 days ahead, within the coming week
    const schedule = {
      id: 'sched-weekly-day',
      reportId: 'report-wd',
      frequency: 'weekly',
      hourUtc: 9,
      dayOfWeek: targetDay,
      format: 'csv' as const,
      recipients: ['grace@test.com'],
      enabled: true,
      lastSentAt: null,
      nextRunAt: new Date(Date.now() - 60000).toISOString(),
    };
    registerMemorySchedule(schedule);

    await checkSchedules();

    const next = new Date(schedule.nextRunAt!);
    expect(next.getUTCDay()).toBe(targetDay);
    const days = daysUntil(schedule.nextRunAt!, 9);
    expect(days).toBeGreaterThanOrEqual(1);
    expect(days).toBeLessThanOrEqual(7);
  });
});
