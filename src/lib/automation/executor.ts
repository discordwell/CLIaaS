/**
 * Automation executor: wraps the engine's rule evaluation with audit trail,
 * dry-run capability, and integration with the event dispatcher.
 */

import { runRules, type Rule, type TicketContext, type ExecutionResult } from './engine';
import { buildBaseTicketFromEvent } from './ticket-from-event';
import { bootstrapWorkflows } from '@/lib/workflow/bootstrap';
import { bootstrapRules } from './bootstrap';
import { dispatchSideEffects } from './side-effects';
import { persistAuditEntry } from './audit-store';

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
  workspaceId?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAutomationRules: Rule[] | undefined;
  // eslint-disable-next-line no-var
  var __cliaasAutomationAudit: AuditEntry[] | undefined;
}

export function getAuditLog(workspaceId?: string): AuditEntry[] {
  const log = global.__cliaasAutomationAudit ?? [];
  if (workspaceId) {
    return log.filter(e => e.workspaceId === workspaceId);
  }
  return log;
}

function recordAudit(entry: AuditEntry): void {
  const log = global.__cliaasAutomationAudit ?? [];
  log.unshift(entry);
  // Keep last 500 entries
  if (log.length > 500) log.length = 500;
  global.__cliaasAutomationAudit = log;
}

// ---- Rule storage (in-memory, loaded from DB when available) ----

export function getAutomationRules(workspaceId?: string): Rule[] {
  const rules = global.__cliaasAutomationRules ?? [];
  if (workspaceId) {
    return rules.filter(r => r.workspaceId === workspaceId);
  }
  return rules;
}

export function setAutomationRules(rules: Rule[]): void {
  global.__cliaasAutomationRules = rules;
}

export function addAutomationRule(rule: Rule): void {
  const all = global.__cliaasAutomationRules ?? [];
  all.push(rule);
  global.__cliaasAutomationRules = all;
}

export function removeAutomationRule(id: string, workspaceId?: string): boolean {
  const rules = global.__cliaasAutomationRules ?? [];
  const idx = rules.findIndex(r => r.id === id && (!workspaceId || r.workspaceId === workspaceId));
  if (idx === -1) return false;
  rules.splice(idx, 1);
  global.__cliaasAutomationRules = rules;
  return true;
}

export function updateAutomationRule(id: string, patch: Partial<Rule>, workspaceId?: string): Rule | null {
  const rules = global.__cliaasAutomationRules ?? [];
  const idx = rules.findIndex(r => r.id === id && (!workspaceId || r.workspaceId === workspaceId));
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
  const startTime = performance.now();
  const results = runRules(rules, ticket, triggerType);
  const durationMs = Math.round(performance.now() - startTime);

  for (const result of results) {
    if (result.matched) {
      const matchedRule = rules.find(r => r.id === result.ruleId);
      // Fire-and-forget persistent audit
      persistAuditEntry({
        id: crypto.randomUUID(),
        ruleId: result.ruleId,
        ruleName: result.ruleName,
        ruleType: matchedRule?.type,
        ticketId: ticket.id,
        event,
        matched: true,
        actionsExecuted: result.actionsExecuted,
        actions: result.changes,
        changes: result.changes,
        errors: result.errors,
        notificationsSent: result.notifications.length,
        webhooksFired: result.webhooks.length,
        durationMs,
        timestamp: new Date().toISOString(),
        dryRun,
        workspaceId: matchedRule?.workspaceId,
      }).catch(() => {}); // fire-and-forget
    }
  }

  return results;
}

// ---- Loop prevention ----

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAutomationDepth: number | undefined;
}

const MAX_AUTOMATION_DEPTH = 2;

// ---- Apply execution results ----

export async function applyExecutionResults(
  result: ExecutionResult,
  ticket: TicketContext,
  dryRun: boolean,
): Promise<{ ticket: TicketContext; notificationsSent: number; webhooksFired: number; errors: string[] }> {
  if (dryRun) {
    return { ticket, notificationsSent: 0, webhooksFired: 0, errors: [] };
  }

  // Apply field changes to ticket
  const updated = { ...ticket, ...result.changes };

  // Loop prevention: skip side effects if we're too deep
  const depth = global.__cliaasAutomationDepth ?? 0;
  if (depth >= MAX_AUTOMATION_DEPTH) {
    return { ticket: updated, notificationsSent: 0, webhooksFired: 0, errors: ['Skipped side effects: max automation depth reached'] };
  }

  global.__cliaasAutomationDepth = depth + 1;
  try {
    const report = await dispatchSideEffects(result, ticket);
    return { ticket: updated, ...report };
  } finally {
    global.__cliaasAutomationDepth = depth;
  }
}

// ---- Integration point for the dispatcher ----

export async function evaluateAutomation(
  event: string,
  data: Record<string, unknown>,
  triggerType: 'trigger' | 'sla',
): Promise<void> {
  // Ensure workflow-generated rules are loaded into the engine
  await bootstrapWorkflows();

  // Ensure DB rules are loaded into the engine
  const workspaceId = data.workspaceId != null ? String(data.workspaceId) : undefined;
  await bootstrapRules(workspaceId);

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
    case 'ticket.merged': return 'merge';
    case 'ticket.split': return 'split';
    case 'ticket.unmerged': return 'unmerge';
    default: return undefined;
  }
}
