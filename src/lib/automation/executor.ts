/**
 * Automation executor: wraps the engine's rule evaluation with audit trail,
 * dry-run capability, and integration with the event dispatcher.
 */

import { runRules, type Rule, type TicketContext, type ExecutionResult } from './engine';
import { buildBaseTicketFromEvent } from './ticket-from-event';
import { bootstrapWorkflows } from '@/lib/workflow/bootstrap';

// ---- Audit trail (in-memory, singleton) ----

export interface AuditEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ticketId: string;
  event: string;
  actions: Record<string, unknown>;
  timestamp: string;
  dryRun: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAutomationRules: Rule[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasAutomationAudit: AuditEntry[] | undefined;
}

export function getAuditLog(): AuditEntry[] {
  return global.__cliaasAutomationAudit ?? [];
}

function recordAudit(entry: AuditEntry): void {
  const log = global.__cliaasAutomationAudit ?? [];
  log.unshift(entry);
  // Keep last 500 entries
  if (log.length > 500) log.length = 500;
  global.__cliaasAutomationAudit = log;
}

// ---- Rule storage (in-memory, loaded from DB when available) ----

export function getAutomationRules(): Rule[] {
  return global.__cliaasAutomationRules ?? [];
}

export function setAutomationRules(rules: Rule[]): void {
  global.__cliaasAutomationRules = rules;
}

export function addAutomationRule(rule: Rule): void {
  const rules = getAutomationRules();
  rules.push(rule);
  global.__cliaasAutomationRules = rules;
}

export function removeAutomationRule(id: string): boolean {
  const rules = getAutomationRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  global.__cliaasAutomationRules = rules;
  return true;
}

export function updateAutomationRule(id: string, patch: Partial<Rule>): Rule | null {
  const rules = getAutomationRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...patch, id };
  global.__cliaasAutomationRules = rules;
  return rules[idx];
}

// ---- Execute rules against a ticket ----

export interface ExecuteOptions {
  ticket: TicketContext;
  event: string;
  triggerType: 'trigger' | 'automation' | 'sla';
  dryRun?: boolean;
}

export function executeRules(opts: ExecuteOptions): ExecutionResult[] {
  const { ticket, event, triggerType, dryRun = false } = opts;
  const rules = getAutomationRules();
  const results = runRules(rules, ticket, triggerType);

  for (const result of results) {
    if (result.matched) {
      recordAudit({
        id: crypto.randomUUID(),
        ruleId: result.ruleId,
        ruleName: result.ruleName,
        ticketId: ticket.id,
        event,
        actions: result.changes,
        timestamp: new Date().toISOString(),
        dryRun,
      });
    }
  }

  return results;
}

// ---- Apply execution results ----

export function applyExecutionResults(
  result: ExecutionResult,
  ticket: TicketContext,
  dryRun: boolean,
): { ticket: TicketContext; notificationsSent: number; webhooksFired: number } {
  if (dryRun) {
    return { ticket, notificationsSent: 0, webhooksFired: 0 };
  }

  // Apply field changes to ticket
  const updated = { ...ticket, ...result.changes };

  // Dispatch notifications (log for now; real dispatch would integrate with notification service)
  const notificationsSent = result.notifications.length;

  // Fire webhooks (log for now; real dispatch would use fetch)
  const webhooksFired = result.webhooks.length;

  return { ticket: updated, notificationsSent, webhooksFired };
}

// ---- Integration point for the dispatcher ----

export async function evaluateAutomation(
  event: string,
  data: Record<string, unknown>,
  triggerType: 'trigger' | 'sla',
): Promise<void> {
  // Ensure workflow-generated rules are loaded into the engine
  await bootstrapWorkflows();

  // Build a TicketContext from the event data
  const base = buildBaseTicketFromEvent(data);
  const ticket: TicketContext = {
    ...base,
    source: data.source != null ? String(data.source) : undefined,
    event: mapEventToContext(event),
    previousStatus: data.previousStatus != null ? String(data.previousStatus) : undefined,
    previousPriority: data.previousPriority != null ? String(data.previousPriority) : undefined,
    previousAssignee: data.previousAssignee != null ? String(data.previousAssignee) : undefined,
    messageBody: data.messageBody != null ? String(data.messageBody) : undefined,
  };

  if (!ticket.id) return;

  executeRules({ ticket, event, triggerType });
}

function mapEventToContext(event: string): TicketContext['event'] {
  switch (event) {
    case 'ticket.created': return 'create';
    case 'ticket.updated': return 'update';
    case 'message.created': return 'reply';
    case 'ticket.resolved': return 'status_change';
    default: return undefined;
  }
}
