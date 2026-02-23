import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAutomationRules,
  setAutomationRules,
  addAutomationRule,
  removeAutomationRule,
  updateAutomationRule,
  executeRules,
  getAuditLog,
  evaluateAutomation,
} from '../executor';
import type { Rule, TicketContext } from '../engine';

const baseTicket: TicketContext = {
  id: 'ticket-1',
  subject: 'Test ticket',
  status: 'open',
  priority: 'normal',
  requester: 'user@test.com',
  tags: ['bug'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  event: 'create',
};

const sampleRule: Rule = {
  id: 'rule-1',
  type: 'trigger',
  name: 'Auto-tag urgent',
  enabled: true,
  conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] },
  actions: [{ type: 'add_tag', value: 'urgent-flagged' }],
};

beforeEach(() => {
  setAutomationRules([]);
  global.__cliaasAutomationAudit = [];
});

describe('rule CRUD', () => {
  it('starts with empty rules', () => {
    expect(getAutomationRules()).toEqual([]);
  });

  it('adds and retrieves rules', () => {
    addAutomationRule(sampleRule);
    expect(getAutomationRules()).toHaveLength(1);
    expect(getAutomationRules()[0].id).toBe('rule-1');
  });

  it('removes a rule', () => {
    addAutomationRule(sampleRule);
    expect(removeAutomationRule('rule-1')).toBe(true);
    expect(getAutomationRules()).toHaveLength(0);
  });

  it('returns false when removing non-existent rule', () => {
    expect(removeAutomationRule('nope')).toBe(false);
  });

  it('updates a rule', () => {
    addAutomationRule(sampleRule);
    const updated = updateAutomationRule('rule-1', { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.id).toBe('rule-1');
  });
});

describe('executeRules', () => {
  it('does not match when conditions fail', () => {
    addAutomationRule(sampleRule);
    const results = executeRules({
      ticket: { ...baseTicket, priority: 'low' },
      event: 'ticket.created',
      triggerType: 'trigger',
    });
    expect(results[0].matched).toBe(false);
  });

  it('matches and records audit when conditions pass', () => {
    addAutomationRule(sampleRule);
    const results = executeRules({
      ticket: { ...baseTicket, priority: 'urgent' },
      event: 'ticket.created',
      triggerType: 'trigger',
    });
    expect(results[0].matched).toBe(true);
    expect(results[0].changes.tags).toContain('urgent-flagged');

    const audit = getAuditLog();
    expect(audit).toHaveLength(1);
    expect(audit[0].ruleId).toBe('rule-1');
    expect(audit[0].dryRun).toBe(false);
  });

  it('records dry run in audit', () => {
    addAutomationRule(sampleRule);
    executeRules({
      ticket: { ...baseTicket, priority: 'urgent' },
      event: 'test',
      triggerType: 'trigger',
      dryRun: true,
    });
    expect(getAuditLog()[0].dryRun).toBe(true);
  });
});

describe('evaluateAutomation', () => {
  it('evaluates rules from event data', async () => {
    addAutomationRule(sampleRule);
    await evaluateAutomation('ticket.created', {
      id: 'ticket-2',
      subject: 'Help',
      status: 'open',
      priority: 'urgent',
      requester: 'a@b.com',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, 'trigger');

    const audit = getAuditLog();
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].ticketId).toBe('ticket-2');
  });

  it('skips when no ticket id in data', async () => {
    addAutomationRule(sampleRule);
    await evaluateAutomation('ticket.created', {}, 'trigger');
    expect(getAuditLog()).toHaveLength(0);
  });
});
