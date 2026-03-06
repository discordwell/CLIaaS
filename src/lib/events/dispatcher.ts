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
  | 'survey.submitted'
  | 'survey.sent'
  | 'automation.executed'
  | 'forum.thread_created'
  | 'forum.reply_created'
  | 'forum.thread_converted'
  | 'qa.review_created'
  | 'qa.review_completed'
  | 'campaign.created'
  | 'campaign.sent'
  | 'customer.updated'
  | 'customer.merged'
  | 'time.entry_created'
  | 'side_conversation.created'
  | 'side_conversation.replied';

// Compile-time check: every CanonicalEvent must be assignable to WebhookEventType
const _typeCheck: Record<CanonicalEvent, WebhookEventType> = {
  'ticket.created': 'ticket.created',
  'ticket.updated': 'ticket.updated',
  'ticket.resolved': 'ticket.resolved',
  'message.created': 'message.created',
  'sla.breached': 'sla.breached',
  'csat.submitted': 'csat.submitted',
  'survey.submitted': 'survey.submitted',
  'survey.sent': 'survey.sent',
  'automation.executed': 'ticket.updated',
  'forum.thread_created': 'forum.thread_created',
  'forum.reply_created': 'forum.reply_created',
  'forum.thread_converted': 'forum.thread_converted',
  'qa.review_created': 'qa.review_created',
  'qa.review_completed': 'qa.review_completed',
  'campaign.created': 'campaign.created',
  'campaign.sent': 'campaign.sent',
  'customer.updated': 'customer.updated',
  'customer.merged': 'customer.merged',
  'time.entry_created': 'time.entry_created',
  'side_conversation.created': 'side_conversation.created',
  'side_conversation.replied': 'side_conversation.replied',
};
void _typeCheck;

// ---- SSE event type mapping (dots → colons) ----

const SSE_EVENT_MAP: Partial<Record<CanonicalEvent, SSEEventType>> = {
  'ticket.created': 'ticket:created',
  'ticket.updated': 'ticket:updated',
  'ticket.resolved': 'ticket:status_changed',
  'message.created': 'ticket:reply',
  'side_conversation.created': 'side_conversation:created',
  'side_conversation.replied': 'side_conversation:replied',
};

// ---- Automation event type mapping ----

type AutomationTriggerType = 'trigger' | 'sla';

const AUTOMATION_EVENT_MAP: Partial<Record<CanonicalEvent, AutomationTriggerType>> = {
  'ticket.created': 'trigger',
  'ticket.updated': 'trigger',
  'message.created': 'trigger',
  'sla.breached': 'sla',
  'side_conversation.replied': 'trigger',
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
      workspaceId: data.workspaceId as string | undefined,
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

    // 5. Routing engine (auto-route new tickets without assignee)
    Promise.resolve().then(async () => {
      if (event === 'ticket.created' && data.ticketId && !data.assignee) {
        try {
          const { routeTicket } = await import('../routing/engine');
          const { availability } = await import('../routing/availability');
          const { getDataProvider } = await import('../data-provider/index');

          const provider = await getDataProvider();
          const tickets = await provider.loadTickets();
          const ticket = tickets.find(t => t.id === data.ticketId);
          if (!ticket || ticket.assignee) return;

          const messages = await provider.loadMessages(ticket.id);
          const allAvail = availability.getAllAvailability();
          const allAgents = allAvail.map(a => ({ userId: a.userId, userName: a.userName }));
          if (allAgents.length === 0) return;

          const result = await routeTicket(ticket, { allAgents, messages });
          if (result.suggestedAgentId) {
            try {
              await provider.updateTicket(ticket.id, { assignee: result.suggestedAgentName });
            } catch { /* JSONL mode — no writes */ }

            eventBus.emit({
              type: 'ticket:routed',
              data: {
                ticketId: ticket.id,
                agentId: result.suggestedAgentId,
                agentName: result.suggestedAgentName,
                strategy: result.strategy,
              },
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          logger.error({ channel: 'routing', event, error: err instanceof Error ? err.message : 'Unknown' }, 'Auto-routing failed');
        }
      }
    }),

    // 6. AI resolution queue (only for eligible events, with quota check; skip internal notes)
    Promise.resolve().then(async () => {
      if (AI_RESOLUTION_EVENTS.has(event) && data.ticketId && !data.isNote && data.visibility !== 'internal') {
        // Check AI call quota before enqueueing
        if (data.tenantId) {
          const { checkQuota, incrementUsage } = await import('../billing/usage');
          const quota = await checkQuota(data.tenantId as string, 'ai_call');
          if (!quota.allowed) {
            logger.info({ channel: 'ai-resolution', event, tenantId: data.tenantId }, 'AI quota exceeded, skipping');
            return;
          }
          void incrementUsage(data.tenantId as string, 'ai_call').catch(() => {});
        }
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
