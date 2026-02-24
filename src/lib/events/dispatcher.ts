/**
 * Unified event dispatcher — fan-out to webhooks, plugins, SSE, automation, and AI resolution.
 * Fire-and-forget via Promise.allSettled, error isolation per channel.
 */

import { dispatchWebhook, type WebhookEventType } from '../webhooks';
import { executePluginHook } from '../plugins';
import { eventBus, type EventType as SSEEventType } from '../realtime/events';
import { evaluateAutomation } from '../automation/executor';
import { enqueueAIResolution } from '../queue/dispatch';
import { createLogger } from '../logger';

const logger = createLogger('events:dispatcher');

// ---- Canonical event types (dot-notation) ----
// All canonical events are a subset of WebhookEventType by design.

export type CanonicalEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.resolved'
  | 'message.created'
  | 'sla.breached'
  | 'csat.submitted'
  | 'automation.executed';

// Compile-time check: every CanonicalEvent must be assignable to WebhookEventType
const _typeCheck: Record<CanonicalEvent, WebhookEventType> = {
  'ticket.created': 'ticket.created',
  'ticket.updated': 'ticket.updated',
  'ticket.resolved': 'ticket.resolved',
  'message.created': 'message.created',
  'sla.breached': 'sla.breached',
  'csat.submitted': 'csat.submitted',
  'automation.executed': 'ticket.updated',
};
void _typeCheck;

// ---- SSE event type mapping (dots → colons) ----

const SSE_EVENT_MAP: Partial<Record<CanonicalEvent, SSEEventType>> = {
  'ticket.created': 'ticket:created',
  'ticket.updated': 'ticket:updated',
  'ticket.resolved': 'ticket:status_changed',
  'message.created': 'ticket:reply',
};

// ---- Automation event type mapping ----

type AutomationTriggerType = 'trigger' | 'sla';

const AUTOMATION_EVENT_MAP: Partial<Record<CanonicalEvent, AutomationTriggerType>> = {
  'ticket.created': 'trigger',
  'ticket.updated': 'trigger',
  'message.created': 'trigger',
  'sla.breached': 'sla',
};

// ---- AI resolution eligible events ----

const AI_RESOLUTION_EVENTS: Set<CanonicalEvent> = new Set([
  'ticket.created',
  'message.created',
]);

// ---- Dispatch ----

export function dispatch(
  event: CanonicalEvent,
  data: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();

  // Fan-out to all 5 channels in parallel, fire-and-forget
  void Promise.allSettled([
    // 1. Webhooks (CanonicalEvent is validated as WebhookEventType subset above)
    dispatchWebhook({
      type: event as WebhookEventType,
      timestamp,
      data,
    }).catch((err) => {
      logger.error({ channel: 'webhooks', event, error: err instanceof Error ? err.message : 'Unknown' }, 'Webhook dispatch failed');
    }),

    // 2. Plugins
    executePluginHook(event, {
      event,
      data,
      timestamp,
    }).catch((err) => {
      logger.error({ channel: 'plugins', event, error: err instanceof Error ? err.message : 'Unknown' }, 'Plugin hook failed');
    }),

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

    // 4. Automation engine (skip for automation.executed to avoid loops)
    Promise.resolve().then(() => {
      const triggerType = AUTOMATION_EVENT_MAP[event];
      if (triggerType) {
        void evaluateAutomation(event, data, triggerType).catch((err) => {
          logger.error({ channel: 'automation', event, error: err instanceof Error ? err.message : 'Unknown' }, 'Automation evaluation failed');
        });
      }
    }),

    // 5. AI resolution queue (only for eligible events)
    Promise.resolve().then(() => {
      if (AI_RESOLUTION_EVENTS.has(event) && data.ticketId) {
        void enqueueAIResolution({
          ticketId: data.ticketId as string,
          event,
          data,
          requestedAt: timestamp,
        }).catch((err) => {
          logger.error({ channel: 'ai-resolution', event, error: err instanceof Error ? err.message : 'Unknown' }, 'AI resolution enqueue failed');
        });
      }
    }),
  ]);
}
