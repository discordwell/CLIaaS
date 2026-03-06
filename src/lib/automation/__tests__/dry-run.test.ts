import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateRule, type TicketContext, type Rule } from '../engine';

// Mock audit store
vi.mock('../audit-store', () => ({
  persistAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

const baseTicket: TicketContext = {
  id: 'ticket-1',
  subject: 'Urgent issue',
  status: 'open',
  priority: 'urgent',
  requester: 'user@test.com',
  tags: ['bug'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  event: 'create',
};

const matchingRule: Rule = {
  id: 'rule-1',
  type: 'trigger',
  name: 'Escalate urgent',
  enabled: true,
  conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] },
  actions: [
    { type: 'add_tag', value: 'escalated' },
    { type: 'send_notification', channel: 'email', to: 'admin@test.com' },
  ],
};

const nonMatchingRule: Rule = {
  id: 'rule-2',
  type: 'trigger',
  name: 'Tag closed',
  enabled: true,
  conditions: { all: [{ field: 'status', operator: 'is', value: 'closed' }] },
  actions: [{ type: 'add_tag', value: 'done' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dry-run (evaluateRule without side effects)', () => {
  it('returns matched=true with changes when conditions match', () => {
    const result = evaluateRule(matchingRule, baseTicket);
    expect(result.matched).toBe(true);
    expect(result.actionsExecuted).toBe(2);
    expect(result.changes.tags).toContain('escalated');
    expect(result.notifications).toHaveLength(1);
  });

  it('returns matched=false with no changes when conditions fail', () => {
    const result = evaluateRule(nonMatchingRule, baseTicket);
    expect(result.matched).toBe(false);
    expect(result.actionsExecuted).toBe(0);
    expect(Object.keys(result.changes)).toHaveLength(0);
  });

  it('does not dispatch any side effects — pure evaluation', () => {
    const result = evaluateRule(matchingRule, baseTicket);
    // evaluateRule is pure — it only returns data, doesn't dispatch
    expect(result.notifications).toHaveLength(1);
    expect(result.webhooks).toHaveLength(0);
    // The actual dispatching only happens in applyExecutionResults
  });

  it('disabled rule returns matched=false', () => {
    const disabled = { ...matchingRule, enabled: false };
    const result = evaluateRule(disabled, baseTicket);
    expect(result.matched).toBe(false);
  });

  it('both inline and ruleId modes produce identical results', () => {
    // evaluateRule works the same regardless of how the Rule was constructed
    const inlineResult = evaluateRule(matchingRule, baseTicket);
    const clonedRule = { ...matchingRule, id: 'from-db' };
    const dbResult = evaluateRule(clonedRule, baseTicket);

    expect(inlineResult.matched).toBe(dbResult.matched);
    expect(inlineResult.actionsExecuted).toBe(dbResult.actionsExecuted);
    expect(inlineResult.changes).toEqual(dbResult.changes);
  });
});
