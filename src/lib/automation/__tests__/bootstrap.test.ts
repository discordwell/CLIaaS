import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAutomationRules,
  setAutomationRules,
} from '../executor';
import { bootstrapRules, invalidateRuleCache } from '../bootstrap';
import type { Rule } from '../engine';

// Mock tryDb
vi.mock('@/lib/store-helpers', () => ({
  tryDb: vi.fn(),
  withRls: vi.fn().mockResolvedValue(null),
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, _type: 'eq' }),
  and: (...conds: unknown[]) => ({ conds, _type: 'and' }),
}));

const { tryDb } = await import('@/lib/store-helpers');
const mockedTryDb = vi.mocked(tryDb);

const wfRule: Rule = {
  id: 'wf-workflow1-step1',
  type: 'trigger',
  name: 'Workflow rule',
  enabled: true,
  conditions: { all: [{ field: 'status', operator: 'is', value: 'open' }] },
  actions: [{ type: 'add_tag', value: 'wf-tagged' }],
};

const dbRuleRow = {
  id: 'db-rule-1',
  workspaceId: 'ws-1',
  type: 'trigger' as const,
  name: 'DB Rule',
  enabled: true,
  conditions: { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] },
  actions: [{ type: 'set_priority', value: 'high' }],
  source: 'zendesk',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockDbWithRows(rows: typeof dbRuleRow[]) {
  const mockSelect = () => ({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  });
  mockedTryDb.mockResolvedValue({
    db: { select: mockSelect } as unknown as ReturnType<typeof import('@/db')['getDb']>,
    schema: {
      rules: {
        enabled: 'enabled',
        workspaceId: 'workspace_id',
      },
    } as unknown as typeof import('@/db/schema'),
  });
}

beforeEach(() => {
  setAutomationRules([]);
  invalidateRuleCache();
  vi.clearAllMocks();
});

describe('bootstrapRules', () => {
  it('loads DB rules into the engine', async () => {
    mockDbWithRows([dbRuleRow]);
    await bootstrapRules();
    const rules = getAutomationRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('db-rule-1');
    expect(rules[0].name).toBe('DB Rule');
  });

  it('is idempotent — second call does not re-query', async () => {
    mockDbWithRows([dbRuleRow]);
    await bootstrapRules();
    await bootstrapRules();
    expect(mockedTryDb).toHaveBeenCalledTimes(1);
  });

  it('invalidation forces reload', async () => {
    mockDbWithRows([dbRuleRow]);
    await bootstrapRules();
    expect(mockedTryDb).toHaveBeenCalledTimes(1);

    invalidateRuleCache();
    mockDbWithRows([{ ...dbRuleRow, id: 'db-rule-2', name: 'Updated' }]);
    await bootstrapRules();
    expect(mockedTryDb).toHaveBeenCalledTimes(2);
    expect(getAutomationRules()[0].id).toBe('db-rule-2');
  });

  it('preserves wf- prefixed rules', async () => {
    setAutomationRules([wfRule]);
    mockDbWithRows([dbRuleRow]);
    await bootstrapRules();
    const rules = getAutomationRules();
    expect(rules).toHaveLength(2);
    expect(rules.find(r => r.id === 'wf-workflow1-step1')).toBeDefined();
    expect(rules.find(r => r.id === 'db-rule-1')).toBeDefined();
  });

  it('no-ops when DB is unavailable', async () => {
    setAutomationRules([wfRule]);
    mockedTryDb.mockResolvedValue(null);
    await bootstrapRules();
    expect(getAutomationRules()).toHaveLength(1);
    expect(getAutomationRules()[0].id).toBe('wf-workflow1-step1');
  });
});
