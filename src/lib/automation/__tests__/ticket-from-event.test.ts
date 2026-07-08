import { describe, it, expect, vi } from 'vitest';
import { buildSampleTicketContext } from '../ticket-from-event';
import { evaluateRule, type Rule } from '../engine';

// evaluateRule may touch the audit store when it runs actions; keep it inert.
vi.mock('../audit-store', () => ({
  persistAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

function conditionRule(field: string, operator: string, value: unknown): Rule {
  return {
    id: 'inline-test',
    type: 'trigger',
    name: 'Inline test',
    enabled: true,
    conditions: { all: [{ field, operator, value }] },
    actions: [],
  } as unknown as Rule;
}

describe('buildSampleTicketContext', () => {
  it('forwards every field the condition evaluator reads', () => {
    const ctx = buildSampleTicketContext({
      id: 't-9',
      subject: 'Cannot log in',
      status: 'solved',
      priority: 'high',
      assignee: 'agent-1',
      requester: 'user@test.com',
      tags: ['login'],
      source: 'email',
      previousStatus: 'open',
      previousPriority: 'normal',
      previousAssignee: null,
      hoursSinceCreated: 5,
      hoursSinceUpdated: 2,
      messageBody: 'still broken',
      event: 'status_change',
      customFields: { plan: 'enterprise' },
    });

    // Fields the old inline mapping silently dropped:
    expect(ctx.source).toBe('email');
    expect(ctx.previousStatus).toBe('open');
    expect(ctx.previousPriority).toBe('normal');
    expect(ctx.hoursSinceCreated).toBe(5);
    expect(ctx.hoursSinceUpdated).toBe(2);
    expect(ctx.messageBody).toBe('still broken');
    expect(ctx.customFields).toEqual({ plan: 'enterprise' });
    // ...alongside the base + event fields it already forwarded:
    expect(ctx.event).toBe('status_change');
    expect(ctx.status).toBe('solved');
    expect(ctx.tags).toEqual(['login']);
  });

  it('coerces numeric strings and drops non-finite hours', () => {
    expect(buildSampleTicketContext({ hoursSinceCreated: '7' }).hoursSinceCreated).toBe(7);
    expect(buildSampleTicketContext({ hoursSinceCreated: 'nope' }).hoursSinceCreated).toBeUndefined();
    expect(buildSampleTicketContext({}).hoursSinceCreated).toBeUndefined();
  });

  it('keeps the historical default id when none is supplied', () => {
    expect(buildSampleTicketContext({}).id).toBe('test-1');
    expect(buildSampleTicketContext({ id: 't-1' }).id).toBe('t-1');
    expect(buildSampleTicketContext({ ticketId: 't-2' }).id).toBe('t-2');
  });
});

describe('rule_test evaluates conditions on the forwarded fields', () => {
  it('matches a rule keyed on source (previously always undefined)', () => {
    const ctx = buildSampleTicketContext({ status: 'open', source: 'email' });
    const result = evaluateRule(conditionRule('source', 'is', 'email'), ctx);
    expect(result.matched).toBe(true);
  });

  it('matches a changed_to transition rule (needs previousStatus)', () => {
    const ctx = buildSampleTicketContext({
      status: 'solved',
      previousStatus: 'open',
      event: 'status_change',
    });
    const result = evaluateRule(conditionRule('status', 'changed_to', 'solved'), ctx);
    expect(result.matched).toBe(true);
  });

  it('matches a rule keyed on a custom field', () => {
    const ctx = buildSampleTicketContext({ status: 'open', customFields: { plan: 'enterprise' } });
    const result = evaluateRule(conditionRule('plan', 'is', 'enterprise'), ctx);
    expect(result.matched).toBe(true);
  });
});
