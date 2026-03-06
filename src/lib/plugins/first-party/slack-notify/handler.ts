/**
 * Slack Notify plugin handler.
 * In production, this would use the Slack Web API to post messages.
 * For now, it logs the notification.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  if (event === 'ticket.created' && cfg.notifyOnCreate === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnCreate disabled' } };
  }
  if (event === 'ticket.resolved' && cfg.notifyOnResolve === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnResolve disabled' } };
  }
  if (event === 'sla.breached' && cfg.notifyOnBreach === false) {
    return { ok: true, data: { skipped: true, reason: 'notifyOnBreach disabled' } };
  }

  const channel = (cfg.channel as string) || '#general';
  const subject = (data.subject as string) || (data.ticketId as string) || 'Unknown';

  // In production: POST to Slack API
  return {
    ok: true,
    data: {
      channel,
      message: `[${event}] ${subject}`,
      event,
    },
  };
}
