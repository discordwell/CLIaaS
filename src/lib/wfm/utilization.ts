/**
 * Agent utilization / occupancy calculation.
 */

import type { TimeEntry } from '@/lib/time-tracking';
import type { AgentStatusEntry, AgentSchedule, UtilizationRecord } from './types';

export function calculateUtilization(
  timeEntries: TimeEntry[],
  statusLog: AgentStatusEntry[],
  schedules: AgentSchedule[],
  filters?: { userId?: string; from?: string; to?: string }
): UtilizationRecord[] {
  let fe = [...timeEntries];
  let fs = [...statusLog];
  if (filters?.userId) { fe = fe.filter(e => e.userId === filters.userId); fs = fs.filter(e => e.userId === filters.userId); }
  if (filters?.from) { const t = new Date(filters.from).getTime(); fe = fe.filter(e => new Date(e.startTime).getTime() >= t); fs = fs.filter(e => new Date(e.startedAt).getTime() >= t); }
  if (filters?.to) { const t = new Date(filters.to).getTime(); fe = fe.filter(e => new Date(e.startTime).getTime() <= t); fs = fs.filter(e => new Date(e.startedAt).getTime() <= t); }

  const nm = new Map<string, string>();
  for (const s of schedules) nm.set(s.userId, s.userName);
  for (const e of fs) nm.set(e.userId, e.userName);
  for (const e of fe) nm.set(e.userId, e.userName);

  const ids = new Set<string>();
  for (const e of fe) ids.add(e.userId);
  for (const e of fs) ids.add(e.userId);

  const now = new Date();
  const records: UtilizationRecord[] = [];

  for (const uid of ids) {
    const hm = fe.filter(e => e.userId === uid).reduce((s, e) => s + e.durationMinutes, 0);
    let am = 0;
    const onlineEntries = fs.filter(e => e.userId === uid && e.status === 'online');
    for (const entry of onlineEntries) {
      const start = new Date(entry.startedAt);
      const next = fs.find(e => e.userId === uid && e.startedAt > entry.startedAt);
      const end = next ? new Date(next.startedAt) : now;
      const mins = (end.getTime() - start.getTime()) / 60000;
      if (mins > 0) am += mins;
    }
    const occ = am > 0 ? Math.min(Math.round((hm / am) * 10000) / 100, 100) : 0;
    records.push({ userId: uid, userName: nm.get(uid) ?? uid, handleMinutes: Math.round(hm * 100) / 100, availableMinutes: Math.round(am * 100) / 100, occupancy: occ });
  }
  return records;
}
