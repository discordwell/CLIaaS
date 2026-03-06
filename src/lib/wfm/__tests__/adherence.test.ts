import { describe, it, expect } from 'vitest';
import { getCurrentAdherence } from '../adherence';
import type { AgentSchedule, AgentCurrentStatus } from '../types';

function makeSchedule(shifts: Array<{ dayOfWeek: number; startTime: string; endTime: string; activity: string }>): AgentSchedule {
  return {
    id: 'sched-1',
    userId: 'user-1',
    userName: 'Alice',
    effectiveFrom: '2026-01-01',
    timezone: 'UTC',
    shifts,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeStatus(status: AgentCurrentStatus['status']): AgentCurrentStatus {
  return {
    userId: 'user-1',
    userName: 'Alice',
    status,
    since: new Date().toISOString(),
  };
}

// Get current UTC day of week for test shifts
const now = new Date();
const dow = now.getUTCDay();
const hh = String(now.getUTCHours()).padStart(2, '0');
const curMin = now.getUTCHours() * 60 + now.getUTCMinutes();

describe('getCurrentAdherence', () => {
  it('marks work+online as adherent', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'work' },
    ]);
    const statuses = [makeStatus('online')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(1);
    expect(records[0].adherent).toBe(true);
    expect(records[0].scheduledActivity).toBe('work');
    expect(records[0].actualStatus).toBe('online');
  });

  it('marks work+away as not adherent', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'work' },
    ]);
    const statuses = [makeStatus('away')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(1);
    expect(records[0].adherent).toBe(false);
  });

  it('marks work+offline as not adherent', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'work' },
    ]);
    const statuses = [makeStatus('offline')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(1);
    expect(records[0].adherent).toBe(false);
  });

  it('marks break+on_break as adherent', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'break' },
    ]);
    const statuses = [makeStatus('on_break')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(1);
    expect(records[0].adherent).toBe(true);
  });

  it('marks break+online as adherent', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'break' },
    ]);
    const statuses = [makeStatus('online')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(1);
    expect(records[0].adherent).toBe(true);
  });

  it('skips off-shift agents', () => {
    // No shifts for today
    const schedule = makeSchedule([
      { dayOfWeek: (dow + 1) % 7, startTime: '09:00', endTime: '17:00', activity: 'work' },
    ]);
    const statuses = [makeStatus('online')];
    const records = getCurrentAdherence([schedule], statuses);
    expect(records).toHaveLength(0);
  });

  it('skips agents with no status', () => {
    const schedule = makeSchedule([
      { dayOfWeek: dow, startTime: '00:00', endTime: '23:59', activity: 'work' },
    ]);
    const records = getCurrentAdherence([schedule], []);
    expect(records).toHaveLength(0);
  });
});
