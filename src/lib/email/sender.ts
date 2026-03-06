/**
 * High-level email sending functions.
 *
 * Uses the unified provider abstraction (provider.ts) which supports
 * Resend, SendGrid, SMTP, and console fallback.
 *
 * Queue integration: when Redis/BullMQ is available, emails are enqueued
 * first and sent by the email worker. When called from the worker itself
 * (_skipQueue=true), the provider is invoked directly.
 */

import { enqueueEmailSend } from '../queue/dispatch';
import { createLogger } from '../logger';
import { getProvider, type EmailMessage, type SendResult } from './provider';

const logger = createLogger('email:sender');

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
}

export async function sendEmail(
  options: EmailOptions,
  _skipQueue = false,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Try queue-first unless called from the email worker itself
  if (!_skipQueue) {
    const enqueued = await enqueueEmailSend(options);
    if (enqueued) {
      logger.debug({ to: options.to, subject: options.subject }, 'Email enqueued');
      return { success: true, messageId: `queued-${Date.now()}` };
    }
  }

  // Build the provider message, mapping threading headers into the headers bag
  const headers: Record<string, string> = {};
  if (options.inReplyTo) headers['In-Reply-To'] = options.inReplyTo;
  if (options.references) headers['References'] = options.references;

  const msg: EmailMessage = {
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    from: options.from,
    replyTo: options.replyTo,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };

  const result: SendResult = await getProvider().send(msg);

  if (!result.success) {
    logger.warn({ to: options.to, error: result.error, provider: result.provider }, 'Email send failed');
  }

  return {
    success: result.success,
    messageId: result.messageId,
    error: result.error,
  };
}

export async function sendTicketReply(params: {
  ticketId: string;
  customerEmail: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  agentName?: string;
  originalMessageId?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const domain = process.env.NEXT_PUBLIC_BASE_URL?.replace(/https?:\/\//, '') || 'cliaas.com';
  const threadId = `<ticket-${params.ticketId}@${domain}>`;

  return sendEmail({
    to: params.customerEmail,
    subject: params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`,
    text: params.body,
    html: params.bodyHtml || `<div>${params.body.replace(/\n/g, '<br>')}</div>`,
    inReplyTo: params.originalMessageId || threadId,
    references: [threadId, params.originalMessageId].filter(Boolean).join(' '),
    from: params.agentName
      ? `${params.agentName} via CLIaaS <noreply@${domain}>`
      : undefined,
  });
}

export async function sendNotification(params: {
  to: string;
  template: string;
  data: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const subjects: Record<string, string> = {
    escalation: `[CLIaaS] Ticket escalated: ${params.data.subject || 'Unknown'}`,
    sla_breach: `[CLIaaS] SLA breach: ${params.data.subject || 'Unknown'}`,
    assignment: `[CLIaaS] Ticket assigned to you: ${params.data.subject || 'Unknown'}`,
    new_ticket: `[CLIaaS] New ticket: ${params.data.subject || 'Unknown'}`,
    mention: `[CLIaaS] ${params.data.authorName || 'Someone'} ${params.data.subject || 'mentioned you'}`,
  };

  return sendEmail({
    to: params.to,
    subject: subjects[params.template] || `[CLIaaS] Notification`,
    text: `${params.template}: ${JSON.stringify(params.data, null, 2)}`,
    html: `<h3>${params.template}</h3><pre>${JSON.stringify(params.data, null, 2)}</pre>`,
  });
}
