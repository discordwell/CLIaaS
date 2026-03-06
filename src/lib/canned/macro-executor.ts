/**
 * Macro execution engine.
 * Processes macro actions sequentially against a ticket.
 */

import type { MacroAction } from './macro-store';
import { resolveMergeVariables, type MergeContext } from './merge';

export interface MacroTicketContext {
  id: string;
  status: string;
  priority: string;
  assignee?: string | null;
  tags: string[];
}

export interface MacroResult {
  actionsExecuted: number;
  changes: Record<string, unknown>;
  replies: string[];
  notes: string[];
  errors: string[];
}

/**
 * Execute a set of macro actions against a ticket context.
 * Returns the result with all changes, replies, and notes.
 */
export function executeMacroActions(
  actions: MacroAction[],
  ticket: MacroTicketContext,
  mergeContext?: MergeContext,
): MacroResult {
  const result: MacroResult = {
    actionsExecuted: 0,
    changes: {},
    replies: [],
    notes: [],
    errors: [],
  };

  for (const action of actions) {
    try {
      executeAction(action, ticket, result, mergeContext);
      result.actionsExecuted++;
    } catch (err) {
      result.errors.push(
        `Action ${action.type} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  return result;
}

function executeAction(
  action: MacroAction,
  ticket: MacroTicketContext,
  result: MacroResult,
  mergeContext?: MergeContext,
): void {
  const value = action.value ?? '';

  switch (action.type) {
    case 'set_status': {
      const valid = ['open', 'pending', 'on_hold', 'solved', 'closed'];
      if (!valid.includes(value)) throw new Error(`Invalid status: ${value}`);
      ticket.status = value;
      result.changes.status = value;
      break;
    }
    case 'set_priority': {
      const valid = ['low', 'normal', 'high', 'urgent'];
      if (!valid.includes(value)) throw new Error(`Invalid priority: ${value}`);
      ticket.priority = value;
      result.changes.priority = value;
      break;
    }
    case 'add_tag': {
      if (value && !ticket.tags.includes(value)) {
        ticket.tags.push(value);
      }
      if (!result.changes.addTags) result.changes.addTags = [];
      (result.changes.addTags as string[]).push(value);
      break;
    }
    case 'remove_tag': {
      ticket.tags = ticket.tags.filter(t => t !== value);
      if (!result.changes.removeTags) result.changes.removeTags = [];
      (result.changes.removeTags as string[]).push(value);
      break;
    }
    case 'assign': {
      ticket.assignee = value || null;
      result.changes.assignee = value || null;
      break;
    }
    case 'assign_group': {
      result.changes.groupId = value;
      break;
    }
    case 'add_reply': {
      const resolved = mergeContext ? resolveMergeVariables(value, mergeContext) : value;
      result.replies.push(resolved);
      break;
    }
    case 'add_note': {
      const resolved = mergeContext ? resolveMergeVariables(value, mergeContext) : value;
      result.notes.push(resolved);
      break;
    }
    case 'set_custom_field': {
      if (!action.field) throw new Error('Custom field name required');
      if (!result.changes.customFields) result.changes.customFields = {};
      (result.changes.customFields as Record<string, unknown>)[action.field] = value;
      break;
    }
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
