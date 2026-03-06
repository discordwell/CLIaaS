/**
 * Live metrics — computes a real-time snapshot of workspace health.
 * Used by the live dashboard SSE stream and MCP dashboard_live tool.
 */

import { getDataProvider } from '@/lib/data-provider/index';

export interface LiveSnapshot {
  queueDepth: Record<string, number>;
  agentsOnline: number;
  avgWaitHours: number;
  createdLastHour: number;
  resolvedLastHour: number;
  slaAtRisk: number;
  timestamp: string;
}

export async function computeLiveSnapshot(workspaceId?: string): Promise<LiveSnapshot> {
  const provider = await getDataProvider();
  const tickets = await provider.loadTickets();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Queue depth by status
  const queueDepth: Record<string, number> = { open: 0, pending: 0, on_hold: 0 };
  for (const t of tickets) {
    if (t.status in queueDepth) {
      queueDepth[t.status]++;
    }
  }

  // Avg wait time for open tickets
  const openTickets = tickets.filter(t => t.status === 'open');
  const waitTimes = openTickets.map(t => (now - new Date(t.createdAt).getTime()) / (1000 * 60 * 60));
  const avgWaitHours = waitTimes.length > 0
    ? Math.round((waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) * 100) / 100
    : 0;

  // Created/resolved last hour
  const createdLastHour = tickets.filter(t =>
    new Date(t.createdAt).getTime() >= oneHourAgo
  ).length;
  const resolvedLastHour = tickets.filter(t =>
    (t.status === 'solved' || t.status === 'closed') &&
    new Date(t.updatedAt).getTime() >= oneHourAgo
  ).length;

  // SLA at-risk: open tickets older than 45 minutes (simple heuristic)
  const slaThreshold = now - 45 * 60 * 1000;
  const slaAtRisk = openTickets.filter(t =>
    new Date(t.createdAt).getTime() < slaThreshold
  ).length;

  // Agents online — try availability module
  let agentsOnline = 0;
  try {
    const { availability } = await import('@/lib/routing/availability');
    const all = availability.getAllAvailability();
    agentsOnline = all.filter(a => a.status === 'online').length;
  } catch {
    agentsOnline = 0;
  }

  return {
    queueDepth,
    agentsOnline,
    avgWaitHours,
    createdLastHour,
    resolvedLastHour,
    slaAtRisk,
    timestamp: new Date().toISOString(),
  };
}
