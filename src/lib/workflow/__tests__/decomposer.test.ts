import { describe, it, expect } from 'vitest';
import { decomposeWorkflowToRules, validateWorkflow } from '../decomposer';
import type { Workflow, WorkflowNode, WorkflowTransition } from '../types';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const triggerId = 'trigger-1';
  const stateAId = 'state-a';
  const stateBId = 'state-b';
  const endId = 'end-1';

  return {
    id: 'wf-test',
    name: 'Test Workflow',
    nodes: {
      [triggerId]: {
        id: triggerId,
        type: 'trigger',
        data: { event: 'create' },
        position: { x: 0, y: 0 },
      },
      [stateAId]: {
        id: stateAId,
        type: 'state',
        data: { label: 'State A' },
        position: { x: 0, y: 100 },
      },
      [stateBId]: {
        id: stateBId,
        type: 'state',
        data: { label: 'State B' },
        position: { x: 0, y: 200 },
      },
      [endId]: {
        id: endId,
        type: 'end',
        data: { label: 'End' },
        position: { x: 0, y: 300 },
      },
    },
    transitions: [
      { id: 't1', fromNodeId: triggerId, toNodeId: stateAId },
      { id: 't2', fromNodeId: stateAId, toNodeId: stateBId, label: 'Progress' },
      { id: 't3', fromNodeId: stateBId, toNodeId: endId, label: 'Close' },
    ],
    entryNodeId: triggerId,
    enabled: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---- Validation ----

describe('validateWorkflow', () => {
  it('accepts a valid workflow', () => {
    const result = validateWorkflow(makeWorkflow());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing entryNodeId', () => {
    const wf = makeWorkflow({ entryNodeId: '' });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('entryNodeId'))).toBe(true);
  });

  it('rejects invalid entryNodeId reference', () => {
    const wf = makeWorkflow({ entryNodeId: 'nonexistent' });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('rejects transitions with invalid fromNodeId', () => {
    const wf = makeWorkflow();
    wf.transitions.push({ id: 'bad', fromNodeId: 'missing', toNodeId: 'state-a' });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('missing'))).toBe(true);
  });

  it('rejects transitions with invalid toNodeId', () => {
    const wf = makeWorkflow();
    wf.transitions.push({ id: 'bad2', fromNodeId: 'state-a', toNodeId: 'missing2' });
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('missing2'))).toBe(true);
  });

  it('detects orphan nodes', () => {
    const wf = makeWorkflow();
    wf.nodes['orphan'] = {
      id: 'orphan',
      type: 'state',
      data: { label: 'Orphan' },
      position: { x: 0, y: 0 },
    };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('orphan'))).toBe(true);
  });

  it('detects trigger node without outgoing transitions', () => {
    const wf = makeWorkflow({ transitions: [] });
    // Remove all transitions — trigger has no outgoing
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('outgoing'))).toBe(true);
  });
});

// ---- Decomposition ----

describe('decomposeWorkflowToRules', () => {
  it('produces rules for a linear workflow', () => {
    const wf = makeWorkflow();
    const rules = decomposeWorkflowToRules(wf);
    expect(rules.length).toBeGreaterThanOrEqual(3);

    // Entry rule should match on event=create
    const entryRule = rules.find(r => r.name.includes('Entry'));
    expect(entryRule).toBeDefined();
    expect(entryRule!.conditions.all).toBeDefined();
    expect(entryRule!.conditions.all!.some(c => c.field === 'event' && c.value === 'create')).toBe(true);

    // Transition rules should swap state tags
    const progressRule = rules.find(r => r.name.includes('State A') && r.name.includes('State B'));
    expect(progressRule).toBeDefined();
    expect(progressRule!.actions.some(a => a.type === 'remove_tag')).toBe(true);
    expect(progressRule!.actions.some(a => a.type === 'add_tag')).toBe(true);
  });

  it('handles branching condition nodes', () => {
    const condId = 'cond-1';
    const wf = makeWorkflow();
    wf.nodes[condId] = {
      id: condId,
      type: 'condition',
      data: {
        logic: 'all',
        conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      position: { x: 0, y: 150 },
    };
    // Replace transition from state-a → state-b with state-a → condition → state-b/end
    wf.transitions = [
      { id: 't1', fromNodeId: 'trigger-1', toNodeId: 'state-a' },
      { id: 't2', fromNodeId: 'state-a', toNodeId: condId },
      { id: 't3', fromNodeId: condId, toNodeId: 'state-b', branchKey: 'yes', label: 'Urgent' },
      { id: 't4', fromNodeId: condId, toNodeId: 'end-1', branchKey: 'no', label: 'Normal' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    // The "yes" branch rule should include the condition node's conditions
    const urgentRule = rules.find(r => r.name.includes('State B'));
    expect(urgentRule).toBeDefined();
    expect(urgentRule!.conditions.all!.some(
      c => c.field === 'priority' && c.operator === 'is' && c.value === 'urgent',
    )).toBe(true);
  });

  it('negates conditions on the "no" branch of condition nodes', () => {
    const condId = 'cond-1';
    const wf = makeWorkflow();
    wf.nodes[condId] = {
      id: condId,
      type: 'condition',
      data: {
        logic: 'all',
        conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      position: { x: 0, y: 150 },
    };
    wf.transitions = [
      { id: 't1', fromNodeId: 'trigger-1', toNodeId: 'state-a' },
      { id: 't2', fromNodeId: 'state-a', toNodeId: condId },
      { id: 't3', fromNodeId: condId, toNodeId: 'state-b', branchKey: 'yes' },
      { id: 't4', fromNodeId: condId, toNodeId: 'end-1', branchKey: 'no' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    // The "no" branch rule should include negated conditions
    const noRule = rules.find(r => r.name.includes('End'));
    expect(noRule).toBeDefined();
    expect(noRule!.conditions.all!.some(
      c => c.field === 'priority' && c.operator === 'is_not' && c.value === 'urgent',
    )).toBe(true);
  });

  it('generates SLA rules for state nodes with slaMinutes', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as Record<string, unknown>).slaMinutes = 120;

    const rules = decomposeWorkflowToRules(wf);
    const slaRule = rules.find(r => r.type === 'sla');
    expect(slaRule).toBeDefined();
    expect(slaRule!.name).toContain('SLA breach');
    expect(slaRule!.conditions.all!.some(c => c.field === 'hours_since_updated')).toBe(true);
    expect(slaRule!.actions.some(a => a.type === 'escalate')).toBe(true);
  });

  it('generates on-enter action rules', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as Record<string, unknown>).onEnterActions = [
      { type: 'add_tag', value: 'entered-a' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    const enterRule = rules.find(r => r.name.includes('Enter'));
    expect(enterRule).toBeDefined();
    expect(enterRule!.actions).toEqual([{ type: 'add_tag', value: 'entered-a' }]);
  });

  it('handles cycles correctly (each transition independent)', () => {
    const wf = makeWorkflow();
    // Add a cycle: state-b → state-a
    wf.transitions.push({ id: 't-cycle', fromNodeId: 'state-b', toNodeId: 'state-a', label: 'Reopen' });

    const rules = decomposeWorkflowToRules(wf);
    // Should have rules for both directions
    const forwardRule = rules.find(
      r => r.name.includes('State A') && r.name.includes('State B') && !r.name.includes('Entry'),
    );
    const cycleRule = rules.find(
      r => r.name.includes('State B') && r.name.includes('State A'),
    );
    expect(forwardRule).toBeDefined();
    expect(cycleRule).toBeDefined();
  });

  it('generates automation-type rules for delay nodes', () => {
    const delayId = 'delay-1';
    const wf = makeWorkflow();
    wf.nodes[delayId] = {
      id: delayId,
      type: 'delay',
      data: { type: 'time', minutes: 120 },
      position: { x: 0, y: 250 },
    };
    // Insert delay between state-b and end
    wf.transitions = [
      { id: 't1', fromNodeId: 'trigger-1', toNodeId: 'state-a' },
      { id: 't2', fromNodeId: 'state-a', toNodeId: 'state-b' },
      { id: 't3', fromNodeId: 'state-b', toNodeId: delayId },
      { id: 't4', fromNodeId: delayId, toNodeId: 'end-1' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    const automationRule = rules.find(r => r.type === 'automation');
    expect(automationRule).toBeDefined();
    expect(automationRule!.conditions.all!.some(
      c => c.field === 'hours_since_updated' && c.operator === 'greater_than',
    )).toBe(true);
  });

  it('includes transition conditions in generated rules', () => {
    const wf = makeWorkflow();
    wf.transitions[1].conditions = [
      { field: 'tags', operator: 'contains', value: 'reviewed' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    const transRule = rules.find(r => r.name.includes('State A') && r.name.includes('State B'));
    expect(transRule).toBeDefined();
    expect(transRule!.conditions.all!.some(
      c => c.field === 'tags' && c.value === 'reviewed',
    )).toBe(true);
  });

  it('includes transition actions in generated rules', () => {
    const wf = makeWorkflow();
    wf.transitions[1].actions = [
      { type: 'add_tag', value: 'progressed' },
    ];

    const rules = decomposeWorkflowToRules(wf);
    const transRule = rules.find(r => r.name.includes('State A') && r.name.includes('State B'));
    expect(transRule).toBeDefined();
    expect(transRule!.actions.some(a => a.type === 'add_tag' && a.value === 'progressed')).toBe(true);
  });

  it('all generated rules respect workflow enabled state', () => {
    const wf = makeWorkflow({ enabled: false });
    const rules = decomposeWorkflowToRules(wf);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every(r => r.enabled === false)).toBe(true);
  });
});
