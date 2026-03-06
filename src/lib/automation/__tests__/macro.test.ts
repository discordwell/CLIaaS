import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyMacro, type TicketContext, type Rule } from '../engine';

// Mock side-effects
vi.mock('../side-effects', () => ({
  dispatchSideEffects: vi.fn().mockResolvedValue({
    notificationsSent: 0,
    webhooksFired: 0,
    errors: [],
  }),
}));

const baseTicket: TicketContext = {
  id: 'ticket-1',
  subject: 'Test ticket',
  status: 'open',
  priority: 'normal',
  requester: 'user@test.com',
  tags: ['bug'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyMacro', () => {
  it('applies all actions regardless of conditions', () => {
    const macro: Rule = {
      id: 'macro-1',
      type: 'macro',
      name: 'Resolve with thanks',
      enabled: true,
      conditions: { all: [{ field: 'status', operator: 'is', value: 'closed' }] },
      actions: [
        { type: 'set_status', value: 'solved' },
        { type: 'add_tag', value: 'resolved-by-agent' },
      ],
    };

    const result = applyMacro(macro, baseTicket);
    expect(result.matched).toBe(true);
    expect(result.changes.status).toBe('solved');
    expect(result.changes.tags).toContain('resolved-by-agent');
    expect(result.actionsExecuted).toBe(2);
  });

  it('generates notifications', () => {
    const macro: Rule = {
      id: 'macro-2',
      type: 'macro',
      name: 'Escalate',
      enabled: true,
      conditions: {},
      actions: [
        { type: 'escalate', to: 'manager@test.com' },
      ],
    };

    const result = applyMacro(macro, baseTicket);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe('email');
    expect(result.changes.priority).toBe('urgent');
  });

  it('generates webhooks', () => {
    const macro: Rule = {
      id: 'macro-3',
      type: 'macro',
      name: 'Webhook test',
      enabled: true,
      conditions: {},
      actions: [
        { type: 'webhook', url: 'https://hook.test', method: 'POST' },
      ],
    };

    const result = applyMacro(macro, baseTicket);
    expect(result.webhooks).toHaveLength(1);
    expect(result.webhooks[0].url).toBe('https://hook.test');
  });

  it('collects errors from invalid actions', () => {
    const macro: Rule = {
      id: 'macro-4',
      type: 'macro',
      name: 'Bad macro',
      enabled: true,
      conditions: {},
      actions: [
        { type: 'unknown_action' },
      ],
    };

    const result = applyMacro(macro, baseTicket);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unknown action type');
  });
});
