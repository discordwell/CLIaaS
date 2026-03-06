import { eventBus, type AppEvent } from '@/lib/realtime/events';
import { requirePerm } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events endpoint for real-time updates.
 * Clients connect via EventSource and receive ticket/presence events.
 * Optional ?ticketId=X parameter filters events to a specific ticket.
 */
export async function GET(request: Request) {
  const auth = await requirePerm(request, 'tickets:view');
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const filterTicketId = url.searchParams.get('ticketId');

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial keepalive
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Keepalive every 30s (declared before onAny so it's in scope for cleanup)
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        }
      }, 30_000);

      // Subscribe to all events
      unsubscribe = eventBus.onAny((event: AppEvent) => {
        try {
          // Filter by ticketId if specified
          if (filterTicketId && event.data?.ticketId && event.data.ticketId !== filterTicketId) {
            return;
          }
          const data = JSON.stringify(event);
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`)
          );
        } catch {
          // Client disconnected — clean up listener and keepalive
          clearInterval(keepalive);
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        }
      });

      // Clean up on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
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
