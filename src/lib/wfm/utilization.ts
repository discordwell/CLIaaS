/**
 * Agent utilization / occupancy calculation.
 * Measures how much of an agent's available time is spent handling tickets.
 */

import type { TimeEntry } from '@/lib/time-tracking';
import type {
  StatusLogEntry,
  AgentSchedule,
  UtilizationRecord,
} from './types';
import { getScheduledWorkMinutes } from './schedules';

/**
 * Calculate utilization for each agent in the dataset.
 *
 * For each agent:
 *   handleMinutes  = sum of time entries' durationMinutes
 *   availableMinutes = sum of 'online' status log durations
 *   If a schedule exists, cap availableMinutes to scheduled work hours
 *   occupancy = (handleMinutes / availableMinutes) * 100
 */
export function calculateUtilization(
  timeEntries: TimeEntry[],
  statusLog: StatusLogEntry[],
  schedules: AgentSchedule[],
  filters?: { userId?: string; from?: string; to?: string }
): UtilizationRecord[] {
  // Apply filters
  let filteredEntries = [...timeEntries];
  let filteredStatusLog = [...statusLog];

  if (filters?.userId) {
    filteredEntries = filteredEntries.filter((e) => e.userId === filters.userId);
    filteredStatusLog = filteredStatusLog.filter((e) => e.userId === filters.userId);
  }
  if (filters?.from) {
    const fromTime = new Date(filters.from).getTime();
    filteredEntries = filteredEntries.filter(
      (e) => new Date(e.startTime).getTime() >= fromTime
    );
    filteredStatusLog = filteredStatusLog.filter(
      (e) => new Date(e.startedAt).getTime() >= fromTime || (e.endedAt === null)
    );
  }
  if (filters?.to) {
    const toTime = new Date(filters.to).getTime();
    filteredEntries = filteredEntries.filter(
      (e) => new Date(e.startTime).getTime() <= toTime
    );
    filteredStatusLog = filteredStatusLog.filter(
      (e) => new Date(e.startedAt).getTime() <= toTime
    );
  }

  // Build schedule lookup
  const scheduleMap = new Map<string, AgentSchedule>();
  for (const s of schedules) {
    scheduleMap.set(s.userId, s);
  }

  // Collect all unique agent IDs
  const agentIds = new Set<string>();
  for (const e of filteredEntries) agentIds.add(e.userId);
  for (const e of filteredStatusLog) agentIds.add(e.userId);

  const now = new Date();
  const fromDate = filters?.from ? new Date(filters.from) : null;
  const toDate = filters?.to ? new Date(filters.to) : null;

  const records: UtilizationRecord[] = [];

  for (const userId of agentIds) {
    // Sum handle time from time entries
    const handleMinutes = filteredEntries
      .filter((e) => e.userId === userId)
      .reduce((sum, e) => sum + e.durationMinutes, 0);

    // Sum available time from status log (only 'online' entries)
    let availableMinutes = 0;
    for (const entry of filteredStatusLog) {
      if (entry.userId !== userId) continue;
      if (entry.status !== 'online') continue;

      const start = new Date(entry.startedAt);
      const end = entry.endedAt ? new Date(entry.endedAt) : now;

      // Clamp to filter range
      const effectiveStart = fromDate && start < fromDate ? fromDate : start;
      const effectiveEnd = toDate && end > toDate ? toDate : end;

      if (effectiveStart < effectiveEnd) {
        availableMinutes += (effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000;
      }
    }

    // Cap to scheduled work hours if schedule exists
    let scheduledMinutes: number | null = null;
    const schedule = scheduleMap.get(userId);
    if (schedule && fromDate && toDate) {
      scheduledMinutes = getScheduledWorkMinutes(schedule, fromDate, toDate);
      availableMinutes = Math.min(availableMinutes, scheduledMinutes);
    }

    // Calculate occupancy percentage
    const occupancy =
      availableMinutes > 0
        ? Math.round((handleMinutes / availableMinutes) * 10000) / 100
        : 0;

    records.push({
      userId,
      handleMinutes: Math.round(handleMinutes * 100) / 100,
      availableMinutes: Math.round(availableMinutes * 100) / 100,
      scheduledMinutes: scheduledMinutes !== null
        ? Math.round(scheduledMinutes * 100) / 100
        : null,
      occupancy,
    });
  }

  return records;
}
