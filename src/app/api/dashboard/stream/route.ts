import { loadTickets, loadMessages, computeStats } from '@/lib/data';
import { checkAllTicketsSLA } from '@/lib/sla';
import { availability } from '@/lib/routing/availability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Dashboard metrics shape sent to clients via SSE.
 */
export interface DashboardMetrics {
  openCount: number;
  pendingCount: number;
  urgentCount: number;
  slaBreaches: number;
  slaWarnings: number;
  unassigned: number;
  agentsOnline: number;
  timestamp: string;
}

async function computeDashboardMetrics(): Promise<DashboardMetrics> {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  const messages = await loadMessages();
  const slaResults = await checkAllTicketsSLA(tickets, messages);

  const slaBreaches = slaResults.filter(
    (r) =>
      r.firstResponse.status === 'breached' ||
      r.resolution.status === 'breached',
  ).length;

  const slaWarnings = slaResults.filter(
    (r) =>
      r.firstResponse.status === 'warning' ||
      r.resolution.status === 'warning',
  ).length;

  const allAvailability = availability.getAllAvailability();
  const agentsOnline = allAvailability.filter((a) => a.status === 'online').length;

  return {
    openCount: stats.byStatus['open'] ?? 0,
    pendingCount: stats.byStatus['pending'] ?? 0,
    urgentCount: stats.byPriority['urgent'] ?? 0,
    slaBreaches,
    slaWarnings,
    unassigned: stats.byAssignee['unassigned'] ?? 0,
    agentsOnline,
    timestamp: new Date().toISOString(),
  };
}

/**
 * SSE endpoint for live dashboard metrics.
 * Streams a DashboardMetrics snapshot every 15 seconds.
 * No auth required (same level as the dashboard page itself).
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot immediately
      try {
        const metrics = await computeDashboardMetrics();
        controller.enqueue(
          encoder.encode(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`),
        );
      } catch {
        controller.enqueue(encoder.encode(': initial snapshot failed\n\n'));
      }

      // Push updated snapshot every 15 seconds
      interval = setInterval(async () => {
        try {
          const metrics = await computeDashboardMetrics();
          controller.enqueue(
            encoder.encode(`event: metrics\ndata: ${JSON.stringify(metrics)}\n\n`),
          );
        } catch {
          // Snapshot computation failed -- send keepalive comment
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            // Client disconnected, clean up
            if (interval) {
              clearInterval(interval);
              interval = null;
            }
          }
        }
      }, 15_000);

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
