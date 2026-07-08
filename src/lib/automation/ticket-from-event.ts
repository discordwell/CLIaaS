/**
 * Shared builder for constructing ticket-like objects from raw event data.
 * Used by both the automation executor (TicketContext) and resolution pipeline (Ticket).
 */

import type { TicketContext } from './engine';

export interface BaseTicketFields {
  id: string;
  subject: string;
  status: string;
  priority: string;
  assignee: string | null;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function buildBaseTicketFromEvent(data: Record<string, unknown>): BaseTicketFields {
  return {
    id: String(data.ticketId ?? data.id ?? ''),
    subject: String(data.subject ?? ''),
    status: String(data.status ?? 'open'),
    priority: String(data.priority ?? 'normal'),
    assignee: data.assignee != null ? String(data.assignee) : null,
    requester: String(data.requester ?? ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };
}

function optionalNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a full TicketContext from a caller-supplied *sample* ticket — used by
 * the MCP `rule_test` dry-run tool.
 *
 * Unlike the event executor (which derives `event` from an event name), here
 * `event` is already a TicketContext event value. Every field the condition
 * evaluator can read — `source`, the transition fields (`previous*`, `event`),
 * `hoursSince*`, `messageBody`, and arbitrary `customFields` — is forwarded, so
 * a dry-run of a rule that keys on any of those evaluates correctly instead of
 * matching against `undefined`.
 */
export function buildSampleTicketContext(sample: Record<string, unknown>): TicketContext {
  const base = buildBaseTicketFromEvent(sample);
  return {
    ...base,
    // Preserve the tool's historical default sample id.
    id: sample.id != null || sample.ticketId != null ? base.id : 'test-1',
    source: sample.source != null ? String(sample.source) : undefined,
    customFields:
      sample.customFields != null &&
      typeof sample.customFields === 'object' &&
      !Array.isArray(sample.customFields)
        ? (sample.customFields as Record<string, unknown>)
        : undefined,
    event: sample.event as TicketContext['event'],
    previousStatus: sample.previousStatus != null ? String(sample.previousStatus) : undefined,
    previousPriority: sample.previousPriority != null ? String(sample.previousPriority) : undefined,
    previousAssignee: sample.previousAssignee != null ? String(sample.previousAssignee) : undefined,
    hoursSinceCreated: optionalNumber(sample.hoursSinceCreated),
    hoursSinceUpdated: optionalNumber(sample.hoursSinceUpdated),
    messageBody: sample.messageBody != null ? String(sample.messageBody) : undefined,
  };
}
