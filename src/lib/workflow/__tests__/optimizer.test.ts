import { describe, it, expect } from 'vitest';
import { optimizeWorkflow } from '../optimizer';
import { validateWorkflow } from '../decomposer';
import type { Workflow, StateNodeData } from '../types';

// ---- Helpers ----

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
        data: { label: 'New' },
        position: { x: 0, y: 100 },
      },
      [stateBId]: {
        id: stateBId,
        type: 'state',
        data: { label: 'In Progress' },
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

// ---- Fix 1: Add missing end node ----

describe('Fix 1: Add missing end node', () => {
  it('adds end node when none exists', () => {
    const wf = makeWorkflow();
    // Remove end node
    delete wf.nodes['end-1'];
    wf.transitions = wf.transitions.filter((t) => t.toNodeId !== 'end-1');

    const { workflow, changes } = optimizeWorkflow(wf);

    const endNodes = Object.values(workflow.nodes).filter((n) => n.type === 'end');
    expect(endNodes.length).toBe(1);
    expect(changes.some((c) => c.type === 'add_end_node')).toBe(true);
  });

  it('does not add end node when one exists', () => {
    const wf = makeWorkflow();
    const { changes } = optimizeWorkflow(wf);
    expect(changes.some((c) => c.type === 'add_end_node')).toBe(false);
  });

  it('positions end node below lowest existing node', () => {
    const wf = makeWorkflow();
    delete wf.nodes['end-1'];
    wf.transitions = wf.transitions.filter((t) => t.toNodeId !== 'end-1');

    const { workflow } = optimizeWorkflow(wf);
    const endNode = Object.values(workflow.nodes).find((n) => n.type === 'end')!;
    // state-b is at y=200, end should be below it
    expect(endNode.position.y).toBeGreaterThan(200);
  });
});

// ---- Fix 2: Connect dead-end states ----

describe('Fix 2: Connect dead-end states', () => {
  it('connects dead-end states to end node', () => {
    const wf = makeWorkflow();
    // Remove transition from state-b to end → state-b becomes dead-end
    wf.transitions = wf.transitions.filter((t) => t.id !== 't3');

    const { workflow, changes } = optimizeWorkflow(wf);

    const stateBOutgoing = workflow.transitions.filter(
      (t) => t.fromNodeId === 'state-b',
    );
    expect(stateBOutgoing.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.type === 'connect_dead_end')).toBe(true);
  });

  it('does not modify nodes that already have outgoing transitions', () => {
    const wf = makeWorkflow();
    const { changes } = optimizeWorkflow(wf);
    expect(changes.filter((c) => c.type === 'connect_dead_end').length).toBe(0);
  });
});

// ---- Fix 3: Add default SLAs ----

describe('Fix 3: Add default SLAs', () => {
  it('adds SLA to state nodes without one', () => {
    const wf = makeWorkflow();

    const { workflow, changes } = optimizeWorkflow(wf);

    const stateA = workflow.nodes['state-a'];
    expect((stateA.data as StateNodeData).slaMinutes).toBeDefined();
    expect(changes.some((c) => c.type === 'add_sla')).toBe(true);
  });

  it('assigns correct SLA based on label', () => {
    const wf = makeWorkflow();

    const { workflow } = optimizeWorkflow(wf);

    // "New" should get 60m (matches "new" keyword)
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(60);
    // "In Progress" should get 240m (matches "progress" keyword)
    expect((workflow.nodes['state-b'].data as StateNodeData).slaMinutes).toBe(240);
  });

  it('does not overwrite existing SLAs', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 30;

    const { workflow } = optimizeWorkflow(wf);
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(30);
  });

  it('uses default SLA for unknown labels', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).label = 'Custom Step';

    const { workflow } = optimizeWorkflow(wf);
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(240);
  });

  it('assigns correct SLA for waiting states', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).label = 'Waiting on Customer';

    const { workflow } = optimizeWorkflow(wf);
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(480);
  });

  it('assigns correct SLA for triage states', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).label = 'Triage';

    const { workflow } = optimizeWorkflow(wf);
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(60);
  });

  it('assigns correct SLA for escalation states', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).label = 'Escalated';

    const { workflow } = optimizeWorkflow(wf);
    expect((workflow.nodes['state-a'].data as StateNodeData).slaMinutes).toBe(120);
  });
});

// ---- Fix 4: Add escalation path ----

describe('Fix 4: Add escalation path', () => {
  it('adds escalation node when SLA states exist but no escalation', () => {
    const wf = makeWorkflow();
    // Pre-add SLAs so the optimizer finds them
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 60;

    const { workflow, changes } = optimizeWorkflow(wf);

    const escNodes = Object.values(workflow.nodes).filter(
      (n) => n.type === 'state' && (n.data as StateNodeData).label === 'Escalated',
    );
    expect(escNodes.length).toBe(1);
    expect(changes.some((c) => c.type === 'add_escalation')).toBe(true);
  });

  it('connects SLA states to escalation node', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 60;

    const { workflow } = optimizeWorkflow(wf);

    const escNode = Object.values(workflow.nodes).find(
      (n) => n.type === 'state' && (n.data as StateNodeData).label === 'Escalated',
    )!;

    const toEsc = workflow.transitions.filter((t) => t.toNodeId === escNode.id);
    expect(toEsc.length).toBeGreaterThan(0);
  });

  it('connects escalation node to end', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 60;

    const { workflow } = optimizeWorkflow(wf);

    const escNode = Object.values(workflow.nodes).find(
      (n) => n.type === 'state' && (n.data as StateNodeData).label === 'Escalated',
    )!;
    const endNode = Object.values(workflow.nodes).find((n) => n.type === 'end')!;

    const escToEnd = workflow.transitions.filter(
      (t) => t.fromNodeId === escNode.id && t.toNodeId === endNode.id,
    );
    expect(escToEnd.length).toBe(1);
  });

  it('does not add escalation when one already exists', () => {
    const wf = makeWorkflow();
    (wf.nodes['state-a'].data as StateNodeData).label = 'Escalated';
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 60;

    const { changes } = optimizeWorkflow(wf);
    expect(changes.some((c) => c.type === 'add_escalation')).toBe(false);
  });
});

// ---- Fix 5: Fix incomplete branches ----

describe('Fix 5: Fix incomplete branches', () => {
  it('adds missing branch to condition with only 1 outgoing', () => {
    const wf = makeWorkflow();
    const condId = 'cond-1';
    wf.nodes[condId] = {
      id: condId,
      type: 'condition',
      data: {
        logic: 'all',
        conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      position: { x: 0, y: 150 },
    };
    // Only one branch (yes)
    wf.transitions.push({
      id: 't-cond-yes',
      fromNodeId: condId,
      toNodeId: 'state-b',
      label: 'Yes',
      branchKey: 'yes',
    });
    // Connect state-a to condition
    wf.transitions = wf.transitions.filter((t) => t.id !== 't2');
    wf.transitions.push({
      id: 't2-new',
      fromNodeId: 'state-a',
      toNodeId: condId,
    });

    const { workflow, changes } = optimizeWorkflow(wf);

    const condOutgoing = workflow.transitions.filter((t) => t.fromNodeId === condId);
    expect(condOutgoing.length).toBe(2);
    expect(changes.some((c) => c.type === 'fix_branch')).toBe(true);
  });

  it('does not modify conditions with 2+ branches', () => {
    const wf = makeWorkflow();
    const condId = 'cond-1';
    wf.nodes[condId] = {
      id: condId,
      type: 'condition',
      data: {
        logic: 'all',
        conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      position: { x: 0, y: 150 },
    };
    wf.transitions.push(
      { id: 't-yes', fromNodeId: condId, toNodeId: 'state-b', branchKey: 'yes' },
      { id: 't-no', fromNodeId: condId, toNodeId: 'end-1', branchKey: 'no' },
    );
    wf.transitions = wf.transitions.filter((t) => t.id !== 't2');
    wf.transitions.push({ id: 't2-new', fromNodeId: 'state-a', toNodeId: condId });

    const { changes } = optimizeWorkflow(wf);
    expect(changes.filter((c) => c.type === 'fix_branch').length).toBe(0);
  });
});

// ---- Overall output ----

describe('optimizeWorkflow overall', () => {
  it('produces a valid workflow', () => {
    const wf = makeWorkflow();
    delete wf.nodes['end-1'];
    wf.transitions = wf.transitions.filter((t) => t.toNodeId !== 'end-1');

    const { workflow } = optimizeWorkflow(wf);
    const validation = validateWorkflow(workflow);
    expect(validation.valid).toBe(true);
  });

  it('does not mutate the input', () => {
    const wf = makeWorkflow();
    const originalJSON = JSON.stringify(wf);
    optimizeWorkflow(wf);
    expect(JSON.stringify(wf)).toBe(originalJSON);
  });

  it('increments version', () => {
    const wf = makeWorkflow();
    wf.version = 3;
    const { workflow } = optimizeWorkflow(wf);
    expect(workflow.version).toBe(4);
  });

  it('returns empty changes for an already-optimized workflow', () => {
    const wf = makeWorkflow();
    // Pre-set SLAs on both states to prevent SLA changes
    (wf.nodes['state-a'].data as StateNodeData).slaMinutes = 60;
    (wf.nodes['state-b'].data as StateNodeData).slaMinutes = 240;
    // Add an Escalated node to prevent escalation addition
    const escId = 'esc-1';
    wf.nodes[escId] = {
      id: escId,
      type: 'state',
      data: { label: 'Escalated', color: 'bg-red-500' } as StateNodeData,
      position: { x: 200, y: 250 },
    };
    wf.transitions.push(
      { id: 't-esc', fromNodeId: 'state-b', toNodeId: escId, label: 'Escalate' },
      { id: 't-esc-end', fromNodeId: escId, toNodeId: 'end-1', label: 'Resolve' },
    );

    const { changes } = optimizeWorkflow(wf);
    // Only SLA on Escalated should trigger (since it has no slaMinutes)
    expect(changes.filter((c) => c.type !== 'add_sla').length).toBe(0);
  });

  it('handles workflow with only trigger node', () => {
    const triggerId = 'trigger-only';
    const wf: Workflow = {
      id: 'wf-bare',
      name: 'Bare',
      nodes: {
        [triggerId]: {
          id: triggerId,
          type: 'trigger',
          data: { event: 'create' },
          position: { x: 300, y: 80 },
        },
      },
      transitions: [],
      entryNodeId: triggerId,
      enabled: true,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const { workflow, changes } = optimizeWorkflow(wf);

    // Should add end node and connect trigger to it
    expect(Object.values(workflow.nodes).some((n) => n.type === 'end')).toBe(true);
    expect(changes.some((c) => c.type === 'add_end_node')).toBe(true);
  });
});
