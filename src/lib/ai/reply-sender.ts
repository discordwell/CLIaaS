/**
 * AI reply sender — executes the action of sending an AI-generated reply.
 * Creates a bot message, sends email for email-channel tickets, updates ticket status.
 */

import { detectPII } from './pii-detector';
import { updateResolutionStatus, type AIResolutionRecord, type AIAgentConfigRecord } from './store';
import { eventBus } from '../realtime/events';
import { createLogger } from '../logger';

const logger = createLogger('ai:reply-sender');

export interface SendReplyResult {
  sent: boolean;
  piiBlocked: boolean;
  messageId?: string;
  error?: string;
}

export async function sendAIReply(
  resolution: AIResolutionRecord,
  config: AIAgentConfigRecord,
): Promise<SendReplyResult> {
  const replyText = resolution.finalReply || resolution.suggestedReply;

  // PII check
  if (config.piiDetection) {
    const piiResult = detectPII(replyText);
    if (piiResult.hasPII) {
      logger.warn({ ticketId: resolution.ticketId, piiTypes: piiResult.findings.map(f => f.type) }, 'PII detected in AI reply, escalating');
      await updateResolutionStatus(resolution.id, 'escalated', {
        errorMessage: `PII detected: ${piiResult.findings.map(f => f.type).join(', ')}`,
      });
      return { sent: false, piiBlocked: true };
    }
  }

  try {
    // Create bot message via DataProvider
    const { getDataProvider } = await import('../data-provider/index');
    const provider = await getDataProvider();

    let messageId: string | undefined;
    try {
      const result = await provider.createMessage({
        ticketId: resolution.ticketId,
        body: replyText,
        authorType: 'bot',
        visibility: 'public',
      });
      messageId = result.id;
    } catch (err) {
      logger.debug({ err }, 'createMessage failed (may be JSONL mode)');
    }

    // Send email for email-channel tickets
    try {
      const tickets = await provider.loadTickets();
      const ticket = tickets.find(t => t.id === resolution.ticketId);
      if (ticket) {
        // Try to get customer email from ticket
        const customers = await provider.loadCustomers();
        const customer = customers.find(c => c.name === ticket.requester || c.email === ticket.requester);
        const customerEmail = customer?.email;

        if (customerEmail) {
          const { sendTicketReply } = await import('../email/sender');
          await sendTicketReply({
            ticketId: ticket.id,
            customerEmail,
            subject: ticket.subject,
            body: replyText,
            agentName: 'AI Assistant',
          });
        }

        // Update ticket status to solved
        try {
          await provider.updateTicket(ticket.id, { status: 'solved' });
        } catch { /* JSONL mode — no writes */ }
      }
    } catch (err) {
      logger.debug({ err }, 'Email send or ticket update failed');
    }

    // Update resolution record
    await updateResolutionStatus(resolution.id, 'auto_resolved', {
      finalReply: replyText,
    });

    // Emit SSE event
    eventBus.emit({
      type: 'ai:resolution_ready' as import('../realtime/events').EventType,
      data: {
        resolutionId: resolution.id,
        ticketId: resolution.ticketId,
        status: 'auto_resolved',
        confidence: resolution.confidence,
      },
      timestamp: Date.now(),
    });

    return { sent: true, piiBlocked: false, messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ ticketId: resolution.ticketId, error: errorMsg }, 'Failed to send AI reply');

    await updateResolutionStatus(resolution.id, 'error', { errorMessage: errorMsg });
    return { sent: false, piiBlocked: false, error: errorMsg };
  }
}
