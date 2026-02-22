import type { TicketContext } from './engine';

export interface RuleAction {
  type: string;
  value?: unknown;
  field?: string;
  channel?: string;
  to?: string;
  template?: string;
  url?: string;
  method?: string;
  body?: string;
}

export interface ActionResult {
  changes: Record<string, unknown>;
  errors: string[];
  notifications: Array<{ type: string; to: string; template?: string; data?: Record<string, unknown> }>;
  webhooks: Array<{ url: string; method: string; body: unknown }>;
}

function executeAction(
  action: RuleAction,
  ticket: TicketContext,
  accumulated: ActionResult
): void {
  switch (action.type) {
    case 'set_status':
      if (typeof action.value === 'string') accumulated.changes.status = action.value;
      break;

    case 'set_priority':
      if (typeof action.value === 'string') accumulated.changes.priority = action.value;
      break;

    case 'set_assignee':
    case 'assign_to':
      accumulated.changes.assignee = action.value ?? null;
      break;

    case 'unassign':
      accumulated.changes.assignee = null;
      break;

    case 'add_tag': {
      if (typeof action.value === 'string') {
        const currentTags = (accumulated.changes.tags as string[]) ?? [...ticket.tags];
        if (!currentTags.includes(action.value)) currentTags.push(action.value);
        accumulated.changes.tags = currentTags;
      }
      break;
    }

    case 'remove_tag': {
      if (typeof action.value === 'string') {
        const tags = (accumulated.changes.tags as string[]) ?? [...ticket.tags];
        accumulated.changes.tags = tags.filter(t => t !== action.value);
      }
      break;
    }

    case 'set_field':
      if (action.field) {
        if (!accumulated.changes.customFields) {
          accumulated.changes.customFields = { ...(ticket.customFields ?? {}) };
        }
        (accumulated.changes.customFields as Record<string, unknown>)[action.field] = action.value;
      }
      break;

    case 'add_internal_note':
      accumulated.changes._internalNote = action.value;
      break;

    case 'send_notification':
      accumulated.notifications.push({
        type: action.channel ?? 'email',
        to: action.to ?? '',
        template: action.template,
        data: { ticketId: ticket.id, subject: ticket.subject },
      });
      break;

    case 'webhook':
      if (action.url) {
        accumulated.webhooks.push({
          url: action.url,
          method: action.method ?? 'POST',
          body: action.body
            ? JSON.parse(action.body)
            : { ticketId: ticket.id, subject: ticket.subject, status: ticket.status },
        });
      }
      break;

    case 'close':
      accumulated.changes.status = 'closed';
      break;

    case 'reopen':
      accumulated.changes.status = 'open';
      break;

    case 'escalate':
      accumulated.changes.priority = 'urgent';
      accumulated.notifications.push({
        type: 'email',
        to: action.to ?? '',
        template: 'escalation',
        data: { ticketId: ticket.id, subject: ticket.subject },
      });
      break;

    default:
      accumulated.errors.push(`Unknown action type: ${action.type}`);
  }
}

export function executeActions(
  actions: RuleAction[],
  ticket: TicketContext
): ActionResult {
  const result: ActionResult = {
    changes: {},
    errors: [],
    notifications: [],
    webhooks: [],
  };

  for (const action of actions) {
    try {
      executeAction(action, ticket, result);
    } catch (err) {
      result.errors.push(
        `Action ${action.type} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
