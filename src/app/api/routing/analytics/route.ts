import { NextRequest, NextResponse } from 'next/server';
import { getRoutingLog, getRoutingQueues } from '@/lib/routing/store';
import { availability } from '@/lib/routing/availability';
import { requireScope } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const auth = await requireScope(request, 'routing:read');
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  const log = getRoutingLog(workspaceId, 1000);
  const queues = getRoutingQueues(workspaceId);
  const allAvail = availability.getAllAvailability();

  // Compute analytics
  const now = Date.now();
  const range = searchParams.get('range') ?? '24h';
  const rangeMs: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const fromTimestamp = rangeMs[range] ? now - rangeMs[range] : 0;

  const todayLog = log.filter(l => new Date(l.createdAt).getTime() > fromTimestamp);

  const avgDurationMs = todayLog.length > 0
    ? todayLog.reduce((sum, l) => sum + (l.durationMs ?? 0), 0) / todayLog.length
    : 0;

  const assignmentsByAgent: Record<string, number> = {};
  const strategyDist: Record<string, number> = {};
  let overflowCount = 0;

  for (const entry of todayLog) {
    if (entry.assignedUserId) {
      assignmentsByAgent[entry.assignedUserId] = (assignmentsByAgent[entry.assignedUserId] ?? 0) + 1;
    }
    strategyDist[entry.strategy] = (strategyDist[entry.strategy] ?? 0) + 1;
    if (entry.reasoning?.includes('Overflow')) overflowCount++;
  }

  // Note: true queue wait time requires tracking when a ticket entered the queue
  // vs when it was assigned. For now we omit this metric rather than report
  // routing computation time as "queue wait time" which would be misleading.

  const onlineCount = allAvail.filter(a => a.status === 'online').length;
  const awayCount = allAvail.filter(a => a.status === 'away').length;
  const offlineCount = allAvail.filter(a => a.status === 'offline').length;
  const totalAgents = allAvail.length;
  const utilization = totalAgents > 0 ? Math.round(((onlineCount + awayCount) / totalAgents) * 100) : 0;

  return NextResponse.json({
    range,
    avgAssignmentTimeMs: Math.round(avgDurationMs),
    totalRoutedToday: todayLog.length,
    overflowCount,
    utilization,
    agentAvailability: { online: onlineCount, away: awayCount, offline: offlineCount },
    assignmentsByAgent,
    strategyDistribution: strategyDist,
    queueCount: queues.length,
  });
}
