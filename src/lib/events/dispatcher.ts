/**
 * Unified event dispatcher — fan-out to webhooks, plugins, and SSE.
 * Fire-and-forget via Promise.allSettled, error isolation per channel.
 */

import { dispatchWebhook, type WebhookEventType } from '../webhooks';
import { executePluginHook } from '../plugins';
import { eventBus, type EventType as SSEEventType } from '../realtime/events';

// ---- Canonical event types (dot-notation) ----

export type CanonicalEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'message.created'
  | 'sla.breached'
  | 'csat.submitted';

// ---- SSE event type mapping (dots → colons) ----

const SSE_EVENT_MAP: Partial<Record<CanonicalEvent, SSEEventType>> = {
  'ticket.created': 'ticket:created',
  'ticket.updated': 'ticket:updated',
  'ticket.resolved': 'ticket:status_changed',
  'message.created': 'ticket:reply',
};

// ---- Dispatch ----

export function dispatch(
  event: CanonicalEvent,
  data: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();

  // Fan-out to all 3 channels in parallel, fire-and-forget
  void Promise.allSettled([
    // 1. Webhooks
    dispatchWebhook({
      type: event as WebhookEventType,
      timestamp,
      data,
    }).catch(() => {}),

    // 2. Plugins
    executePluginHook(event, {
      event,
      data,
      timestamp,
    }).catch(() => {}),

    // 3. SSE (synchronous emit, wrapped for consistency)
    Promise.resolve().then(() => {
      const sseType = SSE_EVENT_MAP[event];
      if (sseType) {
        eventBus.emit({
          type: sseType,
          data,
          timestamp: Date.now(),
        });
      }
    }),
  ]);
}
