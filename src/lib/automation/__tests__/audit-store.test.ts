import { describe, it, expect, beforeEach, vi } from 'vitest';
import { persistAuditEntry, queryAuditLog } from '../audit-store';

// Mock tryDb to return null (no DB)
vi.mock('@/lib/store-helpers', () => ({
  tryDb: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  global.__cliaasAutomationAudit = [];
});

const baseEntry = {
  id: 'exec-1',
  ruleId: 'rule-1',
  ruleName: 'Test rule',
  ruleType: 'trigger' as const,
  ticketId: 'ticket-1',
  event: 'ticket.created',
  matched: true,
  dryRun: false,
  actionsExecuted: 2,
  actions: { status: 'closed' },
  changes: { status: 'closed' },
  errors: [] as string[],
  notificationsSent: 1,
  webhooksFired: 0,
  durationMs: 5,
  timestamp: new Date().toISOString(),
  workspaceId: 'ws-1',
};

describe('persistAuditEntry', () => {
  it('stores entry in-memory', async () => {
    await persistAuditEntry(baseEntry);
    const log = global.__cliaasAutomationAudit ?? [];
    expect(log).toHaveLength(1);
    expect(log[0].ruleId).toBe('rule-1');
  });

  it('limits in-memory log to 500 entries', async () => {
    for (let i = 0; i < 510; i++) {
      await persistAuditEntry({ ...baseEntry, id: `exec-${i}` });
    }
    expect((global.__cliaasAutomationAudit ?? []).length).toBe(500);
  });
});

describe('queryAuditLog', () => {
  it('returns entries filtered by workspaceId', async () => {
    await persistAuditEntry({ ...baseEntry, workspaceId: 'ws-1' });
    await persistAuditEntry({ ...baseEntry, id: 'exec-2', workspaceId: 'ws-2' });

    const results = await queryAuditLog({ workspaceId: 'ws-1' });
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe('rule-1');
  });

  it('returns entries filtered by ruleId', async () => {
    await persistAuditEntry({ ...baseEntry, ruleId: 'rule-1' });
    await persistAuditEntry({ ...baseEntry, id: 'exec-2', ruleId: 'rule-2' });

    const results = await queryAuditLog({ ruleId: 'rule-1' });
    expect(results).toHaveLength(1);
  });

  it('returns entries filtered by ticketId', async () => {
    await persistAuditEntry({ ...baseEntry, ticketId: 'ticket-1' });
    await persistAuditEntry({ ...baseEntry, id: 'exec-2', ticketId: 'ticket-2' });

    const results = await queryAuditLog({ ticketId: 'ticket-1' });
    expect(results).toHaveLength(1);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await persistAuditEntry({ ...baseEntry, id: `exec-${i}` });
    }
    const results = await queryAuditLog({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('tracks duration', async () => {
    await persistAuditEntry({ ...baseEntry, durationMs: 42 });
    const results = await queryAuditLog({});
    expect(results[0].durationMs).toBe(42);
  });
});
