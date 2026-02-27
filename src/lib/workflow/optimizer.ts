/**
 * Deterministic workflow optimizer: runs 5 sequential fixes to
 * auto-repair common workflow issues.
 *
 * Each fix appends to a changes[] array describing what was done.
 * The output always passes validateWorkflow().
 */

import type {
  Workflow,
  WorkflowNode,
  WorkflowTransition,
  StateNodeData,
} from './types';
import { getNodeLabel } from './decomposer';

export interface OptimizeChange {
  type: 'add_end_node' | 'connect_dead_end' | 'add_sla' | 'add_escalation' | 'fix_branch';
  description: string;
  nodeId?: string;
}

export interface OptimizeResult {
  workflow: Workflow;
  changes: OptimizeChange[];
}

/**
 * Run all 5 optimizer fixes in sequence. Returns the fixed workflow
 * and a list of changes made.
 */
export function optimizeWorkflow(input: Workflow): OptimizeResult {
  // Deep clone so we don't mutate the original
  const workflow: Workflow = JSON.parse(JSON.stringify(input));
  const changes: OptimizeChange[] = [];

  addMissingEndNode(workflow, changes);
  connectDeadEndStates(workflow, changes);
  addDefaultSLAs(workflow, changes);
  addEscalationPath(workflow, changes);
  fixIncompleteBranches(workflow, changes);

  workflow.updatedAt = new Date().toISOString();
  workflow.version += 1;

  return { workflow, changes };
}

// ---- Fix 1: Add missing end node ----

function addMissingEndNode(workflow: Workflow, changes: OptimizeChange[]): void {
  const hasEnd = Object.values(workflow.nodes).some((n) => n.type === 'end');
  if (hasEnd) return;

  // Find the lowest node (max y position)
  let maxY = 0;
  for (const node of Object.values(workflow.nodes)) {
    if (node.position.y > maxY) maxY = node.position.y;
  }

  const endId = crypto.randomUUID();
  workflow.nodes[endId] = {
    id: endId,
    type: 'end',
    data: { label: 'Closed' },
    position: { x: 300, y: maxY + 140 },
  };

  changes.push({
    type: 'add_end_node',
    description: 'Added missing end node',
    nodeId: endId,
  });
}

// ---- Fix 2: Connect dead-end states ----

function connectDeadEndStates(workflow: Workflow, changes: OptimizeChange[]): void {
  // Find the end node
  const endNode = Object.values(workflow.nodes).find((n) => n.type === 'end');
  if (!endNode) return;

  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.type === 'end') continue;

    const hasOutgoing = workflow.transitions.some((t) => t.fromNodeId === nodeId);
    if (hasOutgoing) continue;

    const transitionId = crypto.randomUUID();
    workflow.transitions.push({
      id: transitionId,
      fromNodeId: nodeId,
      toNodeId: endNode.id,
      label: 'Close',
    });

    changes.push({
      type: 'connect_dead_end',
      description: `Connected dead-end "${getNodeLabel(node)}" to end node`,
      nodeId,
    });
  }
}

// ---- Fix 3: Add default SLAs ----

const SLA_DEFAULTS: Record<string, number> = {
  new: 60,
  triage: 60,
  progress: 240,
  waiting: 480,
  escalat: 120,
};
const DEFAULT_SLA = 240;

function matchSlaMinutes(label: string): number {
  const lower = label.toLowerCase();
  for (const [keyword, minutes] of Object.entries(SLA_DEFAULTS)) {
    if (lower.includes(keyword)) return minutes;
  }
  return DEFAULT_SLA;
}

function addDefaultSLAs(workflow: Workflow, changes: OptimizeChange[]): void {
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.type !== 'state') continue;
    const data = node.data as StateNodeData;
    if (data.slaMinutes) continue;

    const minutes = matchSlaMinutes(data.label);
    data.slaMinutes = minutes;

    changes.push({
      type: 'add_sla',
      description: `Set ${minutes}m SLA on "${data.label}"`,
      nodeId,
    });
  }
}

// ---- Fix 4: Add escalation path ----

function addEscalationPath(workflow: Workflow, changes: OptimizeChange[]): void {
  // Check if there are SLA states and no escalation node
  const stateNodes = Object.values(workflow.nodes).filter((n) => n.type === 'state');
  const hasSlaStates = stateNodes.some(
    (n) => (n.data as StateNodeData).slaMinutes,
  );
  if (!hasSlaStates) return;

  const hasEscalation = stateNodes.some((n) => {
    const label = (n.data as StateNodeData).label.toLowerCase();
    return label.includes('escalat');
  });
  if (hasEscalation) return;

  // Find end node and position escalation above it
  const endNode = Object.values(workflow.nodes).find((n) => n.type === 'end');
  if (!endNode) return;

  const escId = crypto.randomUUID();
  workflow.nodes[escId] = {
    id: escId,
    type: 'state',
    data: { label: 'Escalated', color: 'bg-red-500' } as StateNodeData,
    position: { x: endNode.position.x + 200, y: endNode.position.y - 70 },
  };

  // Connect SLA-bearing states to escalation
  for (const node of stateNodes) {
    const data = node.data as StateNodeData;
    if (!data.slaMinutes) continue;

    workflow.transitions.push({
      id: crypto.randomUUID(),
      fromNodeId: node.id,
      toNodeId: escId,
      label: 'SLA Breach',
    });
  }

  // Connect escalation to end
  workflow.transitions.push({
    id: crypto.randomUUID(),
    fromNodeId: escId,
    toNodeId: endNode.id,
    label: 'Resolve',
  });

  changes.push({
    type: 'add_escalation',
    description: 'Added escalation path for SLA breach handling',
    nodeId: escId,
  });
}

// ---- Fix 5: Fix incomplete branches ----

function fixIncompleteBranches(workflow: Workflow, changes: OptimizeChange[]): void {
  const endNode = Object.values(workflow.nodes).find((n) => n.type === 'end');
  if (!endNode) return;

  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.type !== 'condition') continue;

    const outgoing = workflow.transitions.filter((t) => t.fromNodeId === nodeId);
    if (outgoing.length >= 2) continue;

    // Determine which branch is missing
    const existingKeys = outgoing.map((t) => t.branchKey).filter(Boolean);
    const missingKey = existingKeys.includes('yes') ? 'no' : 'yes';
    const missingLabel = missingKey === 'yes' ? 'Yes' : 'No';

    workflow.transitions.push({
      id: crypto.randomUUID(),
      fromNodeId: nodeId,
      toNodeId: endNode.id,
      label: missingLabel,
      branchKey: missingKey,
    });

    changes.push({
      type: 'fix_branch',
      description: `Added missing "${missingLabel}" branch to condition node`,
      nodeId,
    });
  }
}

