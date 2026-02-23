/**
 * Automation engine: evaluates rule conditions against ticket data
 * and executes corresponding actions.
 *
 * Rule types:
 * - trigger: fires on ticket events (create, update, reply)
 * - macro: agent-initiated batch of actions
 * - automation: time-based rules (run periodically)
 * - sla: deadline-based escalation
 */

import { evaluateConditions, type RuleConditions } from './conditions';
import { executeActions, type RuleAction } from './actions';

export interface Rule {
  id: string;
  type: 'trigger' | 'macro' | 'automation' | 'sla';
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleAction[];
}

export interface TicketContext {
  id: string;
  subject: string;
  status: string;
  priority: string;
  assignee?: string | null;
  requester: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  customFields?: Record<string, unknown>;
  // Event context
  event?: 'create' | 'update' | 'reply' | 'status_change' | 'assignment';
  previousStatus?: string;
  previousPriority?: string;
  previousAssignee?: string | null;
  hoursSinceCreated?: number;
  hoursSinceUpdated?: number;
  messageBody?: string;
}

export interface ExecutionResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actionsExecuted: number;
  errors: string[];
  changes: Record<string, unknown>;
  notifications: Array<{ type: string; to: string; template?: string; data?: Record<string, unknown> }>;
  webhooks: Array<{ url: string; method: string; body: unknown }>;
}

export function evaluateRule(
  rule: Rule,
  ticket: TicketContext
): ExecutionResult {
  const result: ExecutionResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: false,
    actionsExecuted: 0,
    errors: [],
    changes: {},
    notifications: [],
    webhooks: [],
  };

  if (!rule.enabled) return result;

  try {
    result.matched = evaluateConditions(rule.conditions, ticket);
  } catch (err) {
    result.errors.push(`Condition evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  if (!result.matched) return result;

  const { changes, errors, notifications, webhooks } = executeActions(rule.actions, ticket);
  result.actionsExecuted = rule.actions.length - errors.length;
  result.errors = errors;
  result.changes = changes;
  result.notifications = notifications;
  result.webhooks = webhooks;

  return result;
}

export function runRules(
  rules: Rule[],
  ticket: TicketContext,
  type?: 'trigger' | 'automation' | 'sla'
): ExecutionResult[] {
  const applicable = type ? rules.filter(r => r.type === type) : rules;
  const results: ExecutionResult[] = [];
  let context = { ...ticket };

  for (const rule of applicable) {
    const result = evaluateRule(rule, context);
    results.push(result);

    if (result.matched && Object.keys(result.changes).length > 0) {
      context = { ...context, ...result.changes };
    }
  }

  return results;
}

export function applyMacro(
  rule: Rule,
  ticket: TicketContext
): ExecutionResult {
  const result: ExecutionResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: true,
    actionsExecuted: 0,
    errors: [],
    changes: {},
    notifications: [],
    webhooks: [],
  };

  const { changes, errors, notifications, webhooks } = executeActions(rule.actions, ticket);
  result.actionsExecuted = rule.actions.length - errors.length;
  result.errors = errors;
  result.changes = changes;
  result.notifications = notifications;
  result.webhooks = webhooks;

  return result;
}
