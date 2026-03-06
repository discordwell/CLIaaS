import { describe, it, expect, beforeEach } from 'vitest';
import { getScheduledActivity, countScheduledAgents, detectConflicts } from '../schedules';
import type { AgentSchedule, ShiftBlock } from '../types';

function makeSchedule(overrides?: Partial<AgentSchedule>): AgentSchedule {
  return {
    id: 'sched-test',
    userId: 'user-1',
    userName: 'Test Agent',
    effectiveFrom: '2026-01-01',
    timezone: 'UTC',
    shifts: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', activity: 'work' },
      { dayOfWeek: 1, startTime: '12:00', endTime: '13:00', activity: 'break' },
      { dayOfWeek: 1, startTime: '13:00', endTime: '17:00', activity: 'work' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getScheduledActivity', () => {
  it('returns work during work hours', () => {
    const schedule = makeSchedule();
    // Monday 10:00 UTC
    const date = new Date(Date.UTC(2026, 2, 2, 10, 0));
    expect(getScheduledActivity(schedule, date)).toBe('work');
  });

  it('returns break during break hours', () => {
    const schedule = makeSchedule();
    // Monday 12:30 UTC
    const date = new Date(Date.UTC(2026, 2, 2, 12, 30));
    expect(getScheduledActivity(schedule, date)).toBe('break');
  });

  it('returns off_shift outside scheduled hours', () => {
    const schedule = makeSchedule();
    // Monday 07:00 UTC
    const date = new Date(Date.UTC(2026, 2, 2, 7, 0));
    expect(getScheduledActivity(schedule, date)).toBe('off_shift');
  });

  it('returns off_shift on days with no shifts', () => {
    const schedule = makeSchedule();
    // Sunday 10:00 UTC (dayOfWeek=0, no shifts)
    const date = new Date(Date.UTC(2026, 2, 1, 10, 0));
    expect(getScheduledActivity(schedule, date)).toBe('off_shift');
  });
});

describe('countScheduledAgents', () => {
  it('counts agents scheduled for work at a given hour', () => {
    const schedules: AgentSchedule[] = [
      makeSchedule({ id: 's1', userId: 'u1' }),
      makeSchedule({ id: 's2', userId: 'u2' }),
    ];
    // Monday 10:00 UTC — both should be working
    const count = countScheduledAgents(schedules, '2026-03-02T10:00:00Z');
    expect(count).toBe(2);
  });

  it('returns 0 when no agents scheduled', () => {
    const schedules: AgentSchedule[] = [
      makeSchedule({ id: 's1', userId: 'u1' }),
    ];
    // Monday 07:00 UTC — before shifts
    const count = countScheduledAgents(schedules, '2026-03-02T07:00:00Z');
    expect(count).toBe(0);
  });

  it('does not count agents on break', () => {
    const schedules: AgentSchedule[] = [
      makeSchedule({ id: 's1', userId: 'u1' }),
    ];
    // Monday 12:30 UTC — on break
    const count = countScheduledAgents(schedules, '2026-03-02T12:30:00Z');
    expect(count).toBe(0);
  });
});

describe('detectConflicts', () => {
  it('detects no conflicts with non-overlapping shifts', () => {
    const shifts: ShiftBlock[] = [
      { dayOfWeek: 6, startTime: '09:00', endTime: '17:00', activity: 'work' },
    ];
    // No existing schedules for user-new
    const conflicts = detectConflicts('user-new', shifts, '2026-01-01');
    expect(conflicts).toHaveLength(0);
  });

  it('detects shift overlap with existing schedule', () => {
    // user-1 already has a schedule from the store (demo data: Mon-Fri 09:00-17:00)
    const shifts: ShiftBlock[] = [
      { dayOfWeek: 1, startTime: '08:00', endTime: '10:00', activity: 'work' },
    ];
    const conflicts = detectConflicts('user-1', shifts, '2026-01-01');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some(c => c.type === 'shift_overlap')).toBe(true);
  });

  it('detects no overlap when shifts are on different days', () => {
    // user-1 demo data is Mon-Fri; Saturday shift should not conflict
    const shifts: ShiftBlock[] = [
      { dayOfWeek: 6, startTime: '09:00', endTime: '17:00', activity: 'work' },
    ];
    const conflicts = detectConflicts('user-1', shifts, '2026-01-01');
    const shiftConflicts = conflicts.filter(c => c.type === 'shift_overlap');
    expect(shiftConflicts).toHaveLength(0);
  });
});
