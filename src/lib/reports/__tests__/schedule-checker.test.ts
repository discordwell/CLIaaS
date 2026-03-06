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
});
