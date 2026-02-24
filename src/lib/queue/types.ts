/**
 * Job payload interfaces for all BullMQ queues.
 */

import type { WebhookEventType, RetryPolicy } from '../webhooks';

export interface WebhookDeliveryJob {
  webhookId: string;
  url: string;
  secret: string;
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  retryPolicy: RetryPolicy;
}

export interface AutomationSchedulerJob {
  tick: number;
  scheduledAt: string;
}

export interface AIResolutionJob {
  ticketId: string;
  event: string;
  data: Record<string, unknown>;
  requestedAt: string;
}

export interface EmailSendJob {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
}

/** Queue name constants */
export const QUEUE_NAMES = {
  WEBHOOK_DELIVERY: 'webhook-delivery',
  AUTOMATION_SCHEDULER: 'automation-scheduler',
  AI_RESOLUTION: 'ai-resolution',
  EMAIL_SEND: 'email-send',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
