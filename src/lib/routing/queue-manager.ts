/**
 * Queue manager — evaluate routing rules and match tickets to queues.
 * Reuses the condition evaluation pattern from src/lib/automation/conditions.ts.
 */

import type { RoutingRule, RoutingQueue, RoutingConditions, RoutingCondition } from './types';
import type { Ticket } from '@/lib/data-provider/types';

// ---- Condition evaluation (simplified from automation/conditions.ts) ----

function getTicketField(ticket: Ticket, field: string): unknown {
  switch (field) {
    case 'status': return ticket.status;
    case 'priority': return ticket.priority;
    case 'assignee': return ticket.assignee;
    case 'requester': return ticket.requester;
    case 'subject': return ticket.subject;
    case 'tags': return ticket.tags;
    case 'source': return ticket.source;
    case 'channel': return ticket.source;
    case 'group': return ticket.groupId;
    default:
      if (ticket.customFields && field in ticket.customFields) {
        return ticket.customFields[field];
      }
      return undefined;
  }
}

function evaluateCondition(condition: RoutingCondition, ticket: Ticket): boolean {
  const fieldVal = getTicketField(ticket, condition.field);
  const target = condition.value;

  switch (condition.operator) {
    case 'is':
    case 'equals':
      return String(fieldVal) === String(target);
    case 'is_not':
    case 'not_equals':
      return String(fieldVal) !== String(target);
    case 'contains':
      if (Array.isArray(fieldVal)) return fieldVal.includes(String(target));
      return String(fieldVal ?? '').toLowerCase().includes(String(target).toLowerCase());
    case 'not_contains':
      if (Array.isArray(fieldVal)) return !fieldVal.includes(String(target));
      return !String(fieldVal ?? '').toLowerCase().includes(String(target).toLowerCase());
    case 'in':
      return Array.isArray(target) ? target.includes(String(fieldVal)) : false;
    case 'is_empty':
      return fieldVal === null || fieldVal === undefined || fieldVal === '' ||
        (Array.isArray(fieldVal) && fieldVal.length === 0);
    case 'is_not_empty':
      return fieldVal !== null && fieldVal !== undefined && fieldVal !== '' &&
        !(Array.isArray(fieldVal) && fieldVal.length === 0);
    default:
      return false;
  }
}

export function evaluateConditions(conditions: RoutingConditions, ticket: Ticket): boolean {
  if (!conditions.all?.length && !conditions.any?.length) return true;

  if (conditions.all?.length) {
    if (!conditions.all.every(c => evaluateCondition(c, ticket))) return false;
  }

  if (conditions.any?.length) {
    if (!conditions.any.some(c => evaluateCondition(c, ticket))) return false;
  }

  return true;
}

// ---- Rule evaluation ----

export function evaluateRules(ticket: Ticket, rules: RoutingRule[]): RoutingRule | null {
  const enabled = rules
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of enabled) {
    if (evaluateConditions(rule.conditions, ticket)) {
      return rule;
    }
  }
  return null;
}

// ---- Queue matching ----

export function matchQueue(ticket: Ticket, queues: RoutingQueue[]): RoutingQueue | null {
  const enabled = queues
    .filter(q => q.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const queue of enabled) {
    if (evaluateConditions(queue.conditions, ticket)) {
      return queue;
    }
  }
  return null;
}

export function getOverflowQueue(queue: RoutingQueue, allQueues: RoutingQueue[]): RoutingQueue | null {
  if (!queue.overflowQueueId) return null;
  return allQueues.find(q => q.id === queue.overflowQueueId && q.enabled) ?? null;
}
