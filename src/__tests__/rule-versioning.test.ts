/**
 * Tests for rule versioning: createVersion, listVersions, restoreVersion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock tryDb to return null (JSONL path)
vi.mock('@/lib/store-helpers', () => ({
  tryDb: vi.fn().mockResolvedValue(null),
  getDefaultWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
}));

// Mock jsonl-store
const mockStore: Record<string, unknown[]> = {};
vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: vi.fn((filename: string) => mockStore[filename] ?? []),
  writeJsonlFile: vi.fn((filename: string, items: unknown[]) => {
    mockStore[filename] = items;
  }),
}));

// Mock the executor for JSONL path
const mockRules = [
  {
    id: 'rule-1',
    type: 'trigger' as const,
    name: 'Test Rule',
    enabled: true,
    conditions: { all: [{ field: 'status', operator: 'is', value: 'open' }] },
    actions: [{ type: 'add_tag', value: 'tested' }],
    workspaceId: 'ws-1',
  },
];

vi.mock('@/lib/automation/executor', () => ({
  getAutomationRules: vi.fn((wsId?: string) =>
    wsId ? mockRules.filter(r => r.workspaceId === wsId) : mockRules
  ),
  updateAutomationRule: vi.fn((id: string, patch: Record<string, unknown>) => {
    const rule = mockRules.find(r => r.id === id);
    if (!rule) return null;
    Object.assign(rule, patch);
    return rule;
  }),
}));

vi.mock('@/lib/automation/bootstrap', () => ({
  invalidateRuleCache: vi.fn(),
}));

import { createVersion, listVersions, restoreVersion } from '@/lib/automation/versioning';

describe('Rule Versioning (JSONL path)', () => {
  beforeEach(() => {
    // Clear JSONL store between tests
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
    // Reset rule state
    mockRules[0].name = 'Test Rule';
    mockRules[0].conditions = { all: [{ field: 'status', operator: 'is', value: 'open' }] };
    mockRules[0].actions = [{ type: 'add_tag', value: 'tested' }];
  });

  it('creates a version snapshot of the current rule', async () => {
    const version = await createVersion('rule-1', 'ws-1', 'user-1');

    expect(version).toBeDefined();
    expect(version.ruleId).toBe('rule-1');
    expect(version.workspaceId).toBe('ws-1');
    expect(version.versionNumber).toBe(1);
    expect(version.name).toBe('Test Rule');
    expect(version.createdBy).toBe('user-1');
    expect(version.conditions).toEqual({ all: [{ field: 'status', operator: 'is', value: 'open' }] });
  });

  it('increments version number on successive snapshots', async () => {
    const v1 = await createVersion('rule-1', 'ws-1');
    expect(v1.versionNumber).toBe(1);

    const v2 = await createVersion('rule-1', 'ws-1');
    expect(v2.versionNumber).toBe(2);

    const v3 = await createVersion('rule-1', 'ws-1');
    expect(v3.versionNumber).toBe(3);
  });

  it('lists versions in descending order', async () => {
    await createVersion('rule-1', 'ws-1');
    await createVersion('rule-1', 'ws-1');
    await createVersion('rule-1', 'ws-1');

    const versions = await listVersions('rule-1', 'ws-1');
    expect(versions).toHaveLength(3);
    expect(versions[0].versionNumber).toBe(3);
    expect(versions[1].versionNumber).toBe(2);
    expect(versions[2].versionNumber).toBe(1);
  });

  it('returns empty array when no versions exist', async () => {
    const versions = await listVersions('rule-1', 'ws-1');
    expect(versions).toHaveLength(0);
  });

  it('restores a rule to a previous version', async () => {
    // Create initial snapshot
    const v1 = await createVersion('rule-1', 'ws-1');

    // Simulate rule change
    mockRules[0].name = 'Updated Rule';
    mockRules[0].conditions = { all: [{ field: 'priority', operator: 'is', value: 'urgent' }] };

    // Restore to v1
    const restored = await restoreVersion('rule-1', v1.id, 'ws-1');
    expect(restored.versionNumber).toBe(1);
    expect(restored.name).toBe('Test Rule');
  });

  it('creates a backup snapshot before restoring', async () => {
    const v1 = await createVersion('rule-1', 'ws-1');
    mockRules[0].name = 'Changed Name';

    await restoreVersion('rule-1', v1.id, 'ws-1');

    // Should have 3 versions: original snapshot (v1), backup before restore (v2)
    const versions = await listVersions('rule-1', 'ws-1');
    expect(versions.length).toBe(2);
    // The backup version should capture the "Changed Name" state
    const backup = versions.find(v => v.versionNumber === 2);
    expect(backup?.name).toBe('Changed Name');
  });

  it('throws when restoring a non-existent version', async () => {
    await expect(
      restoreVersion('rule-1', 'non-existent-id', 'ws-1'),
    ).rejects.toThrow('Version non-existent-id not found');
  });

  it('throws when rule does not exist for createVersion', async () => {
    await expect(
      createVersion('non-existent-rule', 'ws-1'),
    ).rejects.toThrow('Rule non-existent-rule not found');
  });

  it('throws when version belongs to different rule', async () => {
    const v1 = await createVersion('rule-1', 'ws-1');

    await expect(
      restoreVersion('different-rule', v1.id, 'ws-1'),
    ).rejects.toThrow('Version does not belong to this rule');
  });
});
