/**
 * Tests for merge/split/unmerge automation event integration.
 * Verifies that the event types are correctly mapped and the
 * automation engine can process them.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule, type Rule, type TicketContext } from '@/lib/automation/engine';

describe('Merge/Split/Unmerge automation events', () => {
  const makeRule = (eventValue: string): Rule => ({
    id: 'test-rule',
    type: 'trigger',
    name: `On ${eventValue}`,
    enabled: true,
    conditions: {
      all: [{ field: 'event', operator: 'is', value: eventValue }],
    },
    actions: [{ type: 'add_tag', value: `auto-${eventValue}` }],
  });

  const makeTicket = (event: TicketContext['event']): TicketContext => ({
    id: 'ticket-1',
    subject: 'Test ticket',
    status: 'open',
    priority: 'normal',
    requester: 'customer@example.com',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    event,
  });

  it('matches rules with event=merge', () => {
    const rule = makeRule('merge');
    const ticket = makeTicket('merge');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(true);
    expect(result.actionsExecuted).toBe(1);
  });

  it('matches rules with event=split', () => {
    const rule = makeRule('split');
    const ticket = makeTicket('split');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(true);
    expect(result.actionsExecuted).toBe(1);
  });

  it('matches rules with event=unmerge', () => {
    const rule = makeRule('unmerge');
    const ticket = makeTicket('unmerge');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(true);
    expect(result.actionsExecuted).toBe(1);
  });

  it('does not match merge rule for create event', () => {
    const rule = makeRule('merge');
    const ticket = makeTicket('create');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(false);
  });

  it('does not match split rule for update event', () => {
    const rule = makeRule('split');
    const ticket = makeTicket('update');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(false);
  });

  it('disabled rules do not fire for merge events', () => {
    const rule: Rule = {
      ...makeRule('merge'),
      enabled: false,
    };
    const ticket = makeTicket('merge');
    const result = evaluateRule(rule, ticket);

    expect(result.matched).toBe(false);
    expect(result.actionsExecuted).toBe(0);
  });
});
