/**
 * Side-effect dispatcher: actually sends notifications and fires webhooks
 * produced by the automation engine.
 */

import type { ExecutionResult, TicketContext } from './engine';

export interface SideEffectReport {
  notificationsSent: number;
  webhooksFired: number;
  errors: string[];
}

export async function dispatchSideEffects(
  result: ExecutionResult,
  ticket: TicketContext,
): Promise<SideEffectReport> {
  const errors: string[] = [];
  let notificationsSent = 0;
  let webhooksFired = 0;

  // Dispatch notifications
  const notifPromises = result.notifications.map(async (notif) => {
    try {
      switch (notif.type) {
        case 'email': {
          const { sendNotification } = await import('@/lib/email/sender');
          await sendNotification({
            to: notif.to,
            template: notif.template ?? 'notification',
            data: { ticketId: ticket.id, subject: ticket.subject, ...notif.data },
          });
          break;
        }
        case 'slack': {
          const { SlackIntegration } = await import('@/lib/integrations/slack');
          const slack = new SlackIntegration();
          await slack.sendNotification({
            title: `Rule: ${result.ruleName}`,
            message: `Ticket ${ticket.id}: ${ticket.subject}`,
            ticketId: ticket.id,
            priority: ticket.priority,
            channel: notif.to,
          });
          break;
        }
        case 'teams': {
          const { TeamsIntegration } = await import('@/lib/integrations/teams');
          const teams = new TeamsIntegration();
          await teams.sendNotification({
            title: `Rule: ${result.ruleName}`,
            message: `Ticket ${ticket.id}: ${ticket.subject}`,
            ticketId: ticket.id,
            priority: ticket.priority,
          });
          break;
        }
        case 'push': {
          const { sendPush } = await import('@/lib/push');
          await sendPush({
            title: `Rule: ${result.ruleName}`,
            body: `Ticket ${ticket.id}: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
          });
          break;
        }
        default:
          errors.push(`Unknown notification type: ${notif.type}`);
          return;
      }
      notificationsSent++;
    } catch (err) {
      errors.push(`Notification (${notif.type}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Dispatch webhooks
  const webhookPromises = result.webhooks.map(async (wh) => {
    try {
      await fetch(wh.url, {
        method: wh.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wh.body),
      });
      webhooksFired++;
    } catch (err) {
      errors.push(`Webhook ${wh.url} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await Promise.allSettled([...notifPromises, ...webhookPromises]);

  return { notificationsSent, webhooksFired, errors };
}
