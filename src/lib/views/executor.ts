import type { ViewQuery, ViewCondition } from './types';
import type { Ticket } from '@/lib/data-provider/types';

function evaluateCondition(ticket: Ticket, condition: ViewCondition, userId?: string): boolean {
  const { field, operator, value } = condition;

  let fieldValue: string | string[] | undefined;
  switch (field) {
    case 'status': fieldValue = ticket.status; break;
    case 'priority': fieldValue = ticket.priority; break;
    case 'assignee': fieldValue = ticket.assignee; break;
    case 'requester': fieldValue = ticket.requester; break;
    case 'source': fieldValue = ticket.source; break;
    case 'tag': fieldValue = ticket.tags; break;
    case 'subject': fieldValue = ticket.subject; break;
    case 'created_at': fieldValue = ticket.createdAt; break;
    case 'updated_at': fieldValue = ticket.updatedAt; break;
    default: return true;
  }

  // Resolve $CURRENT_USER placeholder
  const resolvedValue = value === '$CURRENT_USER' ? (userId ?? '') : (value ?? '');

  // Handle array fields (tags)
  if (Array.isArray(fieldValue)) {
    switch (operator) {
      case 'is': return fieldValue.includes(resolvedValue);
      case 'is_not': return !fieldValue.includes(resolvedValue);
      case 'contains': return fieldValue.some(v => v.toLowerCase().includes(resolvedValue.toLowerCase()));
      case 'not_contains': return !fieldValue.some(v => v.toLowerCase().includes(resolvedValue.toLowerCase()));
      case 'is_empty': return fieldValue.length === 0;
      case 'is_not_empty': return fieldValue.length > 0;
      default: return true;
    }
  }

  const strValue = fieldValue ?? '';

  switch (operator) {
    case 'is':
      return strValue.toLowerCase() === resolvedValue.toLowerCase();
    case 'is_not':
      return strValue.toLowerCase() !== resolvedValue.toLowerCase();
    case 'contains':
      return strValue.toLowerCase().includes(resolvedValue.toLowerCase());
    case 'not_contains':
      return !strValue.toLowerCase().includes(resolvedValue.toLowerCase());
    case 'is_empty':
      return !strValue;
    case 'is_not_empty':
      return !!strValue;
    case 'greater_than': {
      const a = Date.parse(strValue), b = Date.parse(resolvedValue);
      return !isNaN(a) && !isNaN(b) ? a > b : strValue > resolvedValue;
    }
    case 'less_than': {
      const a = Date.parse(strValue), b = Date.parse(resolvedValue);
      return !isNaN(a) && !isNaN(b) ? a < b : strValue < resolvedValue;
    }
    default:
      return true;
  }
}

export function executeViewQuery(
  query: ViewQuery,
  tickets: Ticket[],
  userId?: string,
): Ticket[] {
  let filtered = tickets.filter((ticket) => {
    if (query.conditions.length === 0) return true;

    if (query.combineMode === 'or') {
      return query.conditions.some((c) => evaluateCondition(ticket, c, userId));
    }
    return query.conditions.every((c) => evaluateCondition(ticket, c, userId));
  });

  if (query.sort) {
    const { field, direction } = query.sort;
    filtered.sort((a, b) => {
      const aVal = getFieldValue(a, field);
      const bVal = getFieldValue(b, field);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return direction === 'desc' ? -cmp : cmp;
    });
  }

  return filtered;
}

function getFieldValue(ticket: Ticket, field: string): string {
  switch (field) {
    case 'status': return ticket.status;
    case 'priority': return ticket.priority;
    case 'assignee': return ticket.assignee ?? '';
    case 'requester': return ticket.requester;
    case 'source': return ticket.source;
    case 'subject': return ticket.subject;
    case 'created_at': return ticket.createdAt;
    case 'updated_at': return ticket.updatedAt;
    default: return '';
  }
}
