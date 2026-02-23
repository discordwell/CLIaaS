import { describe, it, expect } from 'vitest';
import { applyExecutionResults } from '../executor';
import type { ExecutionResult, TicketContext } from '../engine';
import { buildBaseTicketFromEvent } from '../ticket-from-event';

const baseTicket: TicketContext = {
  id: 'ticket-1',
  subject: 'Test',
  status: 'open',
  priority: 'normal',
  requester: 'user@test.com',
  tags: ['bug'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    ruleId: 'rule-1',
    ruleName: 'Test rule',
    matched: true,
    actionsExecuted: 1,
    errors: [],
    changes: {},
    notifications: [],
    webhooks: [],
    ...overrides,
  };
}

describe('applyExecutionResults', () => {
  it('applies changes to ticket when not dry-run', () => {
    const result = makeResult({
      changes: { status: 'closed', priority: 'urgent' },
    });
    const { ticket } = applyExecutionResults(result, baseTicket, false);
    expect(ticket.status).toBe('closed');
    expect(ticket.priority).toBe('urgent');
  });

  it('skips all side effects when dry-run', () => {
    const result = makeResult({
      changes: { status: 'closed' },
      notifications: [{ type: 'email', to: 'a@b.com' }],
      webhooks: [{ url: 'https://hook.test', method: 'POST', body: {} }],
    });
    const { ticket, notificationsSent, webhooksFired } = applyExecutionResults(result, baseTicket, true);
    expect(ticket.status).toBe('open'); // unchanged
    expect(notificationsSent).toBe(0);
    expect(webhooksFired).toBe(0);
  });

  it('counts notifications and webhooks when not dry-run', () => {
    const result = makeResult({
      notifications: [
        { type: 'email', to: 'a@b.com', template: 'escalation' },
        { type: 'slack', to: '#support' },
      ],
      webhooks: [{ url: 'https://hook.test', method: 'POST', body: {} }],
    });
    const { notificationsSent, webhooksFired } = applyExecutionResults(result, baseTicket, false);
    expect(notificationsSent).toBe(2);
    expect(webhooksFired).toBe(1);
  });

  it('propagates notifications and webhooks through ExecutionResult', () => {
    const result = makeResult({
      notifications: [{ type: 'email', to: 'admin@test.com', data: { ticketId: 'ticket-1' } }],
      webhooks: [{ url: 'https://api.test/webhook', method: 'POST', body: { event: 'escalated' } }],
    });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].to).toBe('admin@test.com');
    expect(result.webhooks).toHaveLength(1);
    expect(result.webhooks[0].url).toBe('https://api.test/webhook');
  });
});

describe('buildBaseTicketFromEvent', () => {
  it('produces correct ticket shape from full data', () => {
    const data = {
      ticketId: 'tk-42',
      subject: 'Help me',
      status: 'pending',
      priority: 'high',
      assignee: 'agent@test.com',
      requester: 'user@test.com',
      tags: ['billing', 'urgent'],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };
    const ticket = buildBaseTicketFromEvent(data);
    expect(ticket.id).toBe('tk-42');
    expect(ticket.subject).toBe('Help me');
    expect(ticket.status).toBe('pending');
    expect(ticket.priority).toBe('high');
    expect(ticket.assignee).toBe('agent@test.com');
    expect(ticket.requester).toBe('user@test.com');
    expect(ticket.tags).toEqual(['billing', 'urgent']);
    expect(ticket.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(ticket.updatedAt).toBe('2025-01-02T00:00:00Z');
  });

  it('uses defaults for missing fields', () => {
    const ticket = buildBaseTicketFromEvent({});
    expect(ticket.id).toBe('');
    expect(ticket.status).toBe('open');
    expect(ticket.priority).toBe('normal');
    expect(ticket.assignee).toBeNull();
    expect(ticket.tags).toEqual([]);
  });

  it('falls back to data.id when ticketId missing', () => {
    const ticket = buildBaseTicketFromEvent({ id: 'fallback-id' });
    expect(ticket.id).toBe('fallback-id');
  });
});
