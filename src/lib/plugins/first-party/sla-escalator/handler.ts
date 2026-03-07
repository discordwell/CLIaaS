/**
 * SLA Escalator plugin handler.
 * On SLA breach, auto-escalates ticket priority by one level and adds an internal note.
 * In production, this would call the ticket API to update priority and post a note.
 */

import type { PluginHookContext, PluginHandlerResult } from '../../types';

const PRIORITY_LADDER = ['low', 'normal', 'high', 'urgent'] as const;

function escalatePriority(current: string): string {
  const idx = PRIORITY_LADDER.indexOf(current as typeof PRIORITY_LADDER[number]);
  if (idx === -1) return 'high'; // unknown priority defaults to high
  const next = Math.min(idx + 1, PRIORITY_LADDER.length - 1);
  return PRIORITY_LADDER[next];
}

export async function handle(context: PluginHookContext): Promise<PluginHandlerResult> {
  const { event, data, config } = context;
  const cfg = config ?? {};

  if (event !== 'sla.breached') {
    return { ok: true, data: { skipped: true, reason: `Unsupported event: ${event}` } };
  }

  const currentPriority = (data.priority as string) || 'normal';
  const newPriority = escalatePriority(currentPriority);
  const ticketId = (data.ticketId as string) || 'unknown';
  const slaMetric = (data.slaMetric as string) || 'unknown';

  const escalateToGroup = cfg.escalateToGroup as string | undefined;
  const addTag = cfg.addTag as string | undefined;

  const note = `[SLA Escalator] SLA "${slaMetric}" breached on ticket ${ticketId}. ` +
    `Priority escalated from ${currentPriority} to ${newPriority}.` +
    (escalateToGroup ? ` Reassigned to group: ${escalateToGroup}.` : '') +
    (addTag ? ` Tag added: ${addTag}.` : '');

  // In production: PATCH ticket priority, POST internal note
  return {
    ok: true,
    data: {
      action: 'escalate',
      ticketId,
      previousPriority: currentPriority,
      newPriority,
      ...(escalateToGroup ? { escalateToGroup } : {}),
      ...(addTag ? { tag: addTag } : {}),
      note,
    },
  };
}
