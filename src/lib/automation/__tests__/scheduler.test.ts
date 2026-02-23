import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startScheduler, stopScheduler, isSchedulerRunning, runSchedulerTick } from '../scheduler';
import { setAutomationRules } from '../executor';
import type { Rule, TicketContext } from '../engine';

const timeBasedRule: Rule = {
  id: 'auto-close',
  type: 'automation',
  name: 'Auto close idle tickets',
  enabled: true,
  conditions: { all: [{ field: 'hours_since_updated', operator: 'greater_than', value: 168 }] },
  actions: [{ type: 'set_status', value: 'closed' }],
};

const oldTicket: TicketContext = {
  id: 'old-1',
  subject: 'Old ticket',
  status: 'open',
  priority: 'low',
  requester: 'a@b.com',
  tags: [],
  createdAt: new Date(Date.now() - 14 * 24 * 3_600_000).toISOString(),
  updatedAt: new Date(Date.now() - 14 * 24 * 3_600_000).toISOString(),
};

beforeEach(() => {
  setAutomationRules([]);
  global.__cliaasAutomationAudit = [];
});

afterEach(() => {
  stopScheduler();
});

describe('scheduler', () => {
  it('starts and stops', () => {
    startScheduler({
      tickIntervalMs: 60_000,
      getActiveTickets: async () => [],
    });
    expect(isSchedulerRunning()).toBe(true);
    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
  });

  it('runSchedulerTick evaluates automation rules', async () => {
    setAutomationRules([timeBasedRule]);

    startScheduler({
      tickIntervalMs: 60_000,
      getActiveTickets: async () => [oldTicket],
    });

    const matched = await runSchedulerTick();
    expect(matched).toBe(1);
  });

  it('returns 0 when no automation rules', async () => {
    startScheduler({
      tickIntervalMs: 60_000,
      getActiveTickets: async () => [oldTicket],
    });
    const matched = await runSchedulerTick();
    expect(matched).toBe(0);
  });
});
