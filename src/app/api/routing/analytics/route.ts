import { NextRequest, NextResponse } from 'next/server';
import { getRoutingLog, getRoutingQueues } from '@/lib/routing/store';
import { availability } from '@/lib/routing/availability';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  const log = getRoutingLog(workspaceId, 1000);
  const queues = getRoutingQueues(workspaceId);
  const allAvail = availability.getAllAvailability();

  // Compute analytics
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const todayLog = log.filter(l => new Date(l.createdAt).getTime() > oneDayAgo);

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

  const onlineCount = allAvail.filter(a => a.status === 'online').length;
  const awayCount = allAvail.filter(a => a.status === 'away').length;
  const offlineCount = allAvail.filter(a => a.status === 'offline').length;
  const totalAgents = allAvail.length;
  const utilization = totalAgents > 0 ? Math.round(((onlineCount + awayCount) / totalAgents) * 100) : 0;

  return NextResponse.json({
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
