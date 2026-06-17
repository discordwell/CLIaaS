import { describe, it, expect } from 'vitest';
import { calculateUtilization } from '../utilization';
import type { TimeEntry } from '@/lib/time-tracking';
import type { AgentStatusEntry, AgentSchedule } from '../types';

describe('calculateUtilization', () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000);
  const twoHoursAgo = new Date(now.getTime() - 7200000);

  it('calculates occupancy correctly', () => {
    const timeEntries: TimeEntry[] = [
      {
        id: 'te-1',
        ticketId: 't-1',
        userId: 'user-1',
        userName: 'Alice',
        startTime: twoHoursAgo.toISOString(),
        endTime: null,
        durationMinutes: 30,
        billable: true,
        notes: 'Worked on ticket',
      },
    ];

    const statusLog: AgentStatusEntry[] = [
      {
        id: 'ast-1',
        userId: 'user-1',
        userName: 'Alice',
        status: 'online',
        startedAt: twoHoursAgo.toISOString(),
      },
    ];

    const schedules: AgentSchedule[] = [];

    const records = calculateUtilization(timeEntries, statusLog, schedules);
    expect(records).toHaveLength(1);
    expect(records[0].userId).toBe('user-1');
    expect(records[0].userName).toBe('Alice');
    expect(records[0].handleMinutes).toBe(30);
    expect(records[0].availableMinutes).toBeGreaterThan(0);
    // occupancy = 30 / availableMinutes * 100
    expect(records[0].occupancy).toBeGreaterThan(0);
    expect(records[0].occupancy).toBeLessThanOrEqual(100);
  });

  it('returns 0 occupancy with no online time', () => {
    const timeEntries: TimeEntry[] = [
      {
        id: 'te-1',
        ticketId: 't-1',
        userId: 'user-1',
        userName: 'Alice',
        startTime: oneHourAgo.toISOString(),
        endTime: null,
        durationMinutes: 15,
        billable: false,
        notes: '',
      },
    ];

    // No online status entries — only away
    const statusLog: AgentStatusEntry[] = [
      {
        id: 'ast-1',
        userId: 'user-1',
        userName: 'Alice',
        status: 'away',
        startedAt: twoHoursAgo.toISOString(),
      },
    ];

    const records = calculateUtilization(timeEntries, statusLog, []);
    expect(records).toHaveLength(1);
    expect(records[0].occupancy).toBe(0);
  });

  it('handles empty data', () => {
    const records = calculateUtilization([], [], []);
    expect(records).toHaveLength(0);
  });

  it('bounds each online interval by the next status change regardless of input order', () => {
    // Two online intervals (09:00-10:00 and 15:00-16:00) => 120 available minutes.
    // The status log is supplied newest-first (as the DB layer returns it). Before
    // the chronological-sort fix, Array.find matched the first *array* element later
    // than each entry, stretching the 09:00 online interval all the way to 16:00.
    const t = (h: number) => `2026-03-09T${String(h).padStart(2, '0')}:00:00.000Z`;
    const statusLog: AgentStatusEntry[] = [
      { id: 'a4', userId: 'user-1', userName: 'Alice', status: 'away', startedAt: t(16) },
      { id: 'a3', userId: 'user-1', userName: 'Alice', status: 'online', startedAt: t(15) },
      { id: 'a2', userId: 'user-1', userName: 'Alice', status: 'away', startedAt: t(10) },
      { id: 'a1', userId: 'user-1', userName: 'Alice', status: 'online', startedAt: t(9) },
    ];

    const records = calculateUtilization([], statusLog, []);
    expect(records).toHaveLength(1);
    expect(records[0].availableMinutes).toBe(120);
  });

  it('filters by userId', () => {
    const timeEntries: TimeEntry[] = [
      { id: 'te-1', ticketId: 't-1', userId: 'user-1', userName: 'Alice', startTime: oneHourAgo.toISOString(), endTime: null, durationMinutes: 10, billable: false, notes: '' },
      { id: 'te-2', ticketId: 't-2', userId: 'user-2', userName: 'Bob', startTime: oneHourAgo.toISOString(), endTime: null, durationMinutes: 20, billable: false, notes: '' },
    ];
    const statusLog: AgentStatusEntry[] = [
      { id: 'ast-1', userId: 'user-1', userName: 'Alice', status: 'online', startedAt: twoHoursAgo.toISOString() },
      { id: 'ast-2', userId: 'user-2', userName: 'Bob', status: 'online', startedAt: twoHoursAgo.toISOString() },
    ];

    const records = calculateUtilization(timeEntries, statusLog, [], { userId: 'user-1' });
    expect(records).toHaveLength(1);
    expect(records[0].userId).toBe('user-1');
  });
});
