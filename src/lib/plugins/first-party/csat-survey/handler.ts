/**
 * CSAT Survey Trigger plugin handler.
 * When a ticket is resolved, schedules a CSAT survey to be sent after a configurable delay.
 * In production, this would call the survey API to schedule delivery.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  if (event !== 'ticket.resolved') {
    return { ok: true, data: { skipped: true, reason: `Unsupported event: ${event}` } };
  }

  const ticketId = (data.ticketId as string) || 'unknown';
  const requesterEmail = (data.requesterEmail as string) || 'unknown';
  const tags = (data.tags as string[]) || [];
  const excludeTags = (cfg.excludeTags as string[]) || [];

  // Check if any ticket tags match the exclusion list
  const excludedTag = tags.find((t) => excludeTags.includes(t));
  if (excludedTag) {
    return {
      ok: true,
      data: {
        skipped: true,
        reason: `Ticket has excluded tag: ${excludedTag}`,
        ticketId,
      },
    };
  }

  const delayMinutes = (cfg.delayMinutes as number) || 60;
  const scheduledAt = new Date(
    new Date(context.timestamp).getTime() + delayMinutes * 60 * 1000
  ).toISOString();

  // In production: POST to survey API to schedule delivery
  return {
    ok: true,
    data: {
      action: 'schedule_survey',
      ticketId,
      requesterEmail,
      delayMinutes,
      scheduledAt,
      surveyType: 'csat',
    },
  };
}
