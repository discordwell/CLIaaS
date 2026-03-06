import { requirePerm } from '@/lib/rbac';
import { computeLiveSnapshot } from '@/lib/reports/live-metrics';

export const dynamic = 'force-dynamic';

/**
 * SSE endpoint for live dashboard metrics.
 * Streams a LiveSnapshot every 30 seconds.
 * Clients connect via EventSource.
 */
export async function GET(request: Request) {
  const auth = await requirePerm(request, 'analytics:view');
  if ('error' in auth) return auth.error;

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot immediately
      try {
        const snapshot = await computeLiveSnapshot(auth.user.workspaceId);
        controller.enqueue(
          encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
        );
      } catch {
        controller.enqueue(encoder.encode(': initial snapshot failed\n\n'));
      }

      // Push updated snapshot every 30 seconds
      interval = setInterval(async () => {
        try {
          const snapshot = await computeLiveSnapshot(auth.user.workspaceId);
          controller.enqueue(
            encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
          );
        } catch {
          // Snapshot computation failed — send keepalive instead
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            // Client disconnected
            if (interval) { clearInterval(interval); interval = null; }
          }
        }
      }, 30_000);

      // Clean up on abort
      request.signal.addEventListener('abort', () => {
        if (interval) { clearInterval(interval); interval = null; }
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (interval) { clearInterval(interval); interval = null; }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
