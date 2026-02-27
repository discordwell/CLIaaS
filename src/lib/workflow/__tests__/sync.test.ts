import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncWorkflowRules, syncSingleWorkflow } from '../sync';
import {
  getAutomationRules,
  setAutomationRules,
} from '@/lib/automation/executor';
import type { Workflow } from '../types';
import type { Rule } from '@/lib/automation/engine';

// ---- Mock store ----

const mockWorkflows: Workflow[] = [];

vi.mock('../store', () => ({
  getActiveWorkflows: vi.fn(async () => mockWorkflows.filter((w) => w.enabled)),
  getWorkflow: vi.fn(async (id: string) => mockWorkflows.find((w) => w.id === id) ?? null),
}));

// ---- Helpers ----

function makeWorkflow(id: string, enabled = true): Workflow {
  const triggerId = `${id}-trigger`;
  const stateId = `${id}-state`;
  const endId = `${id}-end`;
  return {
    id,
    name: `Workflow ${id}`,
    nodes: {
      [triggerId]: {
        id: triggerId,
        type: 'trigger',
        data: { event: 'create' },
        position: { x: 0, y: 0 },
      },
      [stateId]: {
        id: stateId,
        type: 'state',
        data: { label: 'Open' },
        position: { x: 0, y: 100 },
      },
      [endId]: {
        id: endId,
        type: 'end',
        data: { label: 'End' },
        position: { x: 0, y: 200 },
      },
    },
    transitions: [
      { id: `${id}-t1`, fromNodeId: triggerId, toNodeId: stateId },
      { id: `${id}-t2`, fromNodeId: stateId, toNodeId: endId, label: 'Close' },
    ],
    entryNodeId: triggerId,
    enabled,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeManualRule(id: string): Rule {
  return {
    id,
    type: 'trigger',
    name: `Manual rule ${id}`,
    enabled: true,
    conditions: { all: [] },
    actions: [{ type: 'add_tag', value: 'manual' }],
  };
}

beforeEach(() => {
  mockWorkflows.length = 0;
  setAutomationRules([]);
});

// ---- syncWorkflowRules ----

describe('syncWorkflowRules', () => {
  it('loads rules from active workflows into the engine', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    const result = await syncWorkflowRules();

    expect(result.ruleCount).toBeGreaterThan(0);
    const rules = getAutomationRules();
    expect(rules.length).toBe(result.ruleCount);
    expect(rules.every((r) => r.id.startsWith('wf-wf1-'))).toBe(true);
  });

  it('preserves manual rules', async () => {
    setAutomationRules([makeManualRule('manual-1')]);
    mockWorkflows.push(makeWorkflow('wf1'));

    await syncWorkflowRules();

    const rules = getAutomationRules();
    expect(rules.some((r) => r.id === 'manual-1')).toBe(true);
    expect(rules.some((r) => r.id.startsWith('wf-wf1-'))).toBe(true);
  });

  it('removes stale workflow rules on re-sync', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    await syncWorkflowRules();

    // Disable workflow and re-sync
    mockWorkflows[0].enabled = false;
    await syncWorkflowRules();

    const rules = getAutomationRules();
    expect(rules.every((r) => !r.id.startsWith('wf-wf1-'))).toBe(true);
  });

  it('handles empty active workflows', async () => {
    setAutomationRules([makeManualRule('m1')]);
    const result = await syncWorkflowRules();

    expect(result.ruleCount).toBe(0);
    expect(getAutomationRules()).toEqual([makeManualRule('m1')]);
  });

  it('handles multiple workflows', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    mockWorkflows.push(makeWorkflow('wf2'));
    const result = await syncWorkflowRules();

    const rules = getAutomationRules();
    expect(rules.some((r) => r.id.startsWith('wf-wf1-'))).toBe(true);
    expect(rules.some((r) => r.id.startsWith('wf-wf2-'))).toBe(true);
    expect(result.ruleCount).toBe(rules.length);
  });
});

// ---- syncSingleWorkflow ----

describe('syncSingleWorkflow', () => {
  it('adds rules for a single enabled workflow', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    const result = await syncSingleWorkflow('wf1', true);

    expect(result.ruleCount).toBeGreaterThan(0);
    const rules = getAutomationRules();
    expect(rules.every((r) => r.id.startsWith('wf-wf1-'))).toBe(true);
  });

  it('removes rules when disabled', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    await syncSingleWorkflow('wf1', true);
    expect(getAutomationRules().length).toBeGreaterThan(0);

    const result = await syncSingleWorkflow('wf1', false);
    expect(result.ruleCount).toBe(0);
    expect(getAutomationRules().length).toBe(0);
  });

  it('preserves other workflow rules and manual rules', async () => {
    setAutomationRules([makeManualRule('m1')]);
    mockWorkflows.push(makeWorkflow('wf1'));
    mockWorkflows.push(makeWorkflow('wf2'));

    await syncSingleWorkflow('wf1', true);
    await syncSingleWorkflow('wf2', true);

    // Disable wf1 — wf2 and manual should remain
    await syncSingleWorkflow('wf1', false);

    const rules = getAutomationRules();
    expect(rules.some((r) => r.id === 'm1')).toBe(true);
    expect(rules.some((r) => r.id.startsWith('wf-wf2-'))).toBe(true);
    expect(rules.some((r) => r.id.startsWith('wf-wf1-'))).toBe(false);
  });

  it('returns 0 rules for non-existent workflow', async () => {
    const result = await syncSingleWorkflow('nonexistent', true);
    expect(result.ruleCount).toBe(0);
  });

  it('replaces old rules on re-sync', async () => {
    mockWorkflows.push(makeWorkflow('wf1'));
    await syncSingleWorkflow('wf1', true);
    const countBefore = getAutomationRules().length;

    await syncSingleWorkflow('wf1', true);
    const countAfter = getAutomationRules().length;

    // Should be same count — old removed, new added
    expect(countAfter).toBe(countBefore);
  });
});
