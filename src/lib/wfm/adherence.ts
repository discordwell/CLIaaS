/**
 * Real-time schedule adherence tracking.
 */

import type { AgentSchedule, AgentCurrentStatus, AdherenceRecord } from './types';
import { getScheduledActivity } from './schedules';

export function getCurrentAdherence(
  schedules: AgentSchedule[],
  statuses: AgentCurrentStatus[]
): AdherenceRecord[] {
  const statusMap = new Map<string, AgentCurrentStatus>();
  for (const s of statuses) statusMap.set(s.userId, s);

  const records: AdherenceRecord[] = [];

  for (const schedule of schedules) {
    const scheduled = getScheduledActivity(schedule);
    if (scheduled === 'off_shift') continue;

    const agentStatus = statusMap.get(schedule.userId);
    if (!agentStatus) continue;

    const actual = agentStatus.status;
    let adherent = false;

    switch (scheduled) {
      case 'work':
        adherent = actual === 'online';
        break;
      case 'break':
        adherent = actual === 'on_break' || actual === 'away' || actual === 'online';
        break;
      case 'training':
      case 'meeting':
        adherent = actual === 'online' || actual === 'away';
        break;
    }

    records.push({
      userId: schedule.userId,
      userName: schedule.userName,
      scheduledActivity: scheduled,
      actualStatus: actual,
      adherent,
      since: agentStatus.since,
    });
  }

  return records;
}
