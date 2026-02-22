import type { TicketContext } from './engine';

export interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

export interface RuleConditions {
  all?: Condition[];
  any?: Condition[];
}

type FieldValue = string | number | boolean | string[] | null | undefined;

function getFieldValue(ticket: TicketContext, field: string): FieldValue {
  switch (field) {
    case 'status': return ticket.status;
    case 'priority': return ticket.priority;
    case 'assignee': return ticket.assignee;
    case 'requester': return ticket.requester;
    case 'subject': return ticket.subject;
    case 'tags': return ticket.tags;
    case 'source': return ticket.source;
    case 'event': return ticket.event;
    case 'previous_status': return ticket.previousStatus;
    case 'previous_priority': return ticket.previousPriority;
    case 'previous_assignee': return ticket.previousAssignee;
    case 'hours_since_created': return ticket.hoursSinceCreated;
    case 'hours_since_updated': return ticket.hoursSinceUpdated;
    case 'message_body': return ticket.messageBody;
    default:
      if (ticket.customFields && field in ticket.customFields) {
        return ticket.customFields[field] as FieldValue;
      }
      return undefined;
  }
}

function evaluateCondition(condition: Condition, ticket: TicketContext): boolean {
  const fieldVal = getFieldValue(ticket, condition.field);
  const targetVal = condition.value;

  switch (condition.operator) {
    case 'is':
    case 'equals':
      return String(fieldVal) === String(targetVal);

    case 'is_not':
    case 'not_equals':
      return String(fieldVal) !== String(targetVal);

    case 'contains':
      if (Array.isArray(fieldVal)) return fieldVal.includes(String(targetVal));
      return String(fieldVal ?? '').toLowerCase().includes(String(targetVal).toLowerCase());

    case 'not_contains':
      if (Array.isArray(fieldVal)) return !fieldVal.includes(String(targetVal));
      return !String(fieldVal ?? '').toLowerCase().includes(String(targetVal).toLowerCase());

    case 'starts_with':
      return String(fieldVal ?? '').toLowerCase().startsWith(String(targetVal).toLowerCase());

    case 'ends_with':
      return String(fieldVal ?? '').toLowerCase().endsWith(String(targetVal).toLowerCase());

    case 'greater_than':
      return Number(fieldVal) > Number(targetVal);

    case 'less_than':
      return Number(fieldVal) < Number(targetVal);

    case 'is_empty':
      return fieldVal === null || fieldVal === undefined || fieldVal === '' ||
        (Array.isArray(fieldVal) && fieldVal.length === 0);

    case 'is_not_empty':
      return fieldVal !== null && fieldVal !== undefined && fieldVal !== '' &&
        !(Array.isArray(fieldVal) && fieldVal.length === 0);

    case 'changed':
      if (condition.field === 'status') return ticket.previousStatus !== undefined && ticket.previousStatus !== ticket.status;
      if (condition.field === 'priority') return ticket.previousPriority !== undefined && ticket.previousPriority !== ticket.priority;
      if (condition.field === 'assignee') return ticket.previousAssignee !== undefined && ticket.previousAssignee !== ticket.assignee;
      return false;

    case 'changed_to':
      if (condition.field === 'status') return ticket.status === String(targetVal) && ticket.previousStatus !== ticket.status;
      if (condition.field === 'priority') return ticket.priority === String(targetVal) && ticket.previousPriority !== ticket.priority;
      return false;

    case 'in':
      return Array.isArray(targetVal) ? targetVal.includes(String(fieldVal)) : false;

    case 'not_in':
      return Array.isArray(targetVal) ? !targetVal.includes(String(fieldVal)) : true;

    case 'matches':
      try {
        return new RegExp(String(targetVal), 'i').test(String(fieldVal ?? ''));
      } catch {
        return false;
      }

    default:
      return false;
  }
}

export function evaluateConditions(
  conditions: RuleConditions,
  ticket: TicketContext
): boolean {
  if (!conditions.all?.length && !conditions.any?.length) return true;

  if (conditions.all?.length) {
    if (!conditions.all.every(c => evaluateCondition(c, ticket))) return false;
  }

  if (conditions.any?.length) {
    if (!conditions.any.some(c => evaluateCondition(c, ticket))) return false;
  }

  return true;
}
