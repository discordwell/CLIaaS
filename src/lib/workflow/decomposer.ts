/**
 * Workflow decomposer: converts a visual workflow graph into Rule[] that
 * the existing automation engine can evaluate.
 *
 * Each transition becomes a trigger rule:
 *   conditions = "ticket has tag wf:<id>:state:<fromNode>" AND transition conditions
 *   actions = transition actions + add tag for toNode + remove tag for fromNode
 *
 * State nodes with onEnterActions generate additional trigger rules.
 * Delay nodes generate automation-type rules with hours_since_updated conditions.
 * Condition nodes expand into branching rules.
 */

import type { Rule } from '@/lib/automation/engine';
import type { RuleConditions, Condition } from '@/lib/automation/conditions';
import type { RuleAction } from '@/lib/automation/actions';
import type {
  Workflow,
  WorkflowNode,
  WorkflowTransition,
  TriggerNodeData,
  StateNodeData,
  ConditionNodeData,
  DelayNodeData,
} from './types';

// ---- Validation ----

export interface ValidationError {
  message: string;
  nodeId?: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateWorkflow(workflow: Workflow): ValidationResult {
  const errors: ValidationError[] = [];

  // Entry node must exist
  if (!workflow.entryNodeId) {
    errors.push({ message: 'Workflow must have an entryNodeId', severity: 'error' });
  } else if (!workflow.nodes[workflow.entryNodeId]) {
    errors.push({ message: `entryNodeId "${workflow.entryNodeId}" does not reference a valid node`, severity: 'error' });
  }

  // All transition refs must be valid
  for (const t of workflow.transitions) {
    if (!workflow.nodes[t.fromNodeId]) {
      errors.push({ message: `Transition "${t.id}" references unknown fromNodeId "${t.fromNodeId}"`, severity: 'error' });
    }
    if (!workflow.nodes[t.toNodeId]) {
      errors.push({ message: `Transition "${t.id}" references unknown toNodeId "${t.toNodeId}"`, severity: 'error' });
    }
  }

  // Detect orphan nodes (not reachable and not the entry)
  const referenced = new Set<string>();
  referenced.add(workflow.entryNodeId);
  for (const t of workflow.transitions) {
    referenced.add(t.fromNodeId);
    referenced.add(t.toNodeId);
  }
  for (const nodeId of Object.keys(workflow.nodes)) {
    if (!referenced.has(nodeId)) {
      errors.push({ message: `Node "${nodeId}" is orphaned (not connected by any transition)`, nodeId, severity: 'error' });
    }
  }

  // Entry node should have outgoing transitions (if it's a trigger)
  if (workflow.entryNodeId && workflow.nodes[workflow.entryNodeId]) {
    const entryNode = workflow.nodes[workflow.entryNodeId];
    if (entryNode.type === 'trigger') {
      const hasOutgoing = workflow.transitions.some(t => t.fromNodeId === workflow.entryNodeId);
      if (!hasOutgoing) {
        errors.push({ message: 'Trigger node must have at least one outgoing transition', nodeId: workflow.entryNodeId, severity: 'error' });
      }
    }
  }

  // Warning: no end node in the workflow
  const hasEnd = Object.values(workflow.nodes).some(n => n.type === 'end');
  if (!hasEnd) {
    errors.push({ message: 'Workflow has no end node — tickets may stay in-progress forever', severity: 'warning' });
  }

  // Per-node warnings
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    const outgoing = workflow.transitions.filter(t => t.fromNodeId === nodeId);
    const incoming = workflow.transitions.filter(t => t.toNodeId === nodeId);

    // Node with no outgoing (skip end nodes)
    if (node.type !== 'end' && outgoing.length === 0) {
      errors.push({ message: `"${getNodeLabel(node)}" has no outgoing transitions`, nodeId, severity: 'warning' });
    }

    // Node with no incoming (skip entry trigger)
    if (nodeId !== workflow.entryNodeId && incoming.length === 0) {
      errors.push({ message: `"${getNodeLabel(node)}" has no incoming transitions`, nodeId, severity: 'warning' });
    }

    // Condition node with fewer than 2 outgoing
    if (node.type === 'condition' && outgoing.length < 2) {
      errors.push({ message: `Condition "${getNodeLabel(node)}" should have at least 2 branches`, nodeId, severity: 'warning' });
    }

    // Action node with empty actions array
    if (node.type === 'action') {
      const actions = (node.data as { actions?: unknown[] }).actions;
      if (!actions || actions.length === 0) {
        errors.push({ message: `Action node has no actions defined`, nodeId, severity: 'warning' });
      }
    }
  }

  // valid = no errors (warnings are ok)
  const hasErrors = errors.some(e => e.severity === 'error');
  return { valid: !hasErrors, errors };
}

// ---- Decomposition ----

/** Prefix for all workflow-generated rule IDs. Used by sync layer to partition rules. */
export const WF_RULE_PREFIX = 'wf-';

function stateTag(workflowId: string, nodeId: string): string {
  return `wf:${workflowId}:state:${nodeId}`;
}

function makeRuleId(workflowId: string, suffix: string): string {
  return `${WF_RULE_PREFIX}${workflowId}-${suffix}`;
}

export function decomposeWorkflowToRules(workflow: Workflow): Rule[] {
  const rules: Rule[] = [];
  const wfId = workflow.id;

  // Process entry trigger node
  const entryNode = workflow.nodes[workflow.entryNodeId];
  if (entryNode?.type === 'trigger') {
    const triggerData = entryNode.data as TriggerNodeData;
    const outgoing = workflow.transitions.filter(t => t.fromNodeId === workflow.entryNodeId);

    for (const transition of outgoing) {
      const conditions: Condition[] = [];

      // Add trigger event condition
      if (triggerData.event) {
        conditions.push({ field: 'event', operator: 'is', value: triggerData.event });
      }

      // Add trigger-level conditions
      if (triggerData.conditions) {
        conditions.push(...triggerData.conditions);
      }

      // Add transition-level conditions
      if (transition.conditions) {
        conditions.push(...transition.conditions);
      }

      const actions: RuleAction[] = [];

      // Transition actions
      if (transition.actions) {
        actions.push(...transition.actions);
      }

      // Set state tag for target node
      actions.push({ type: 'add_tag', value: stateTag(wfId, transition.toNodeId) });

      rules.push({
        id: makeRuleId(wfId, `entry-${transition.id}`),
        type: 'trigger',
        name: `[WF] ${workflow.name}: Entry → ${getNodeLabel(workflow.nodes[transition.toNodeId])}`,
        enabled: workflow.enabled,
        conditions: { all: conditions },
        actions,
      });
    }
  }

  // Process each transition (excluding those from entry trigger — already handled)
  for (const transition of workflow.transitions) {
    if (transition.fromNodeId === workflow.entryNodeId && entryNode?.type === 'trigger') {
      continue; // Already handled above
    }

    const fromNode = workflow.nodes[transition.fromNodeId];
    const toNode = workflow.nodes[transition.toNodeId];
    if (!fromNode || !toNode) continue;

    const conditions: Condition[] = [];

    // Ticket must be in the source state
    conditions.push({
      field: 'tags',
      operator: 'contains',
      value: stateTag(wfId, transition.fromNodeId),
    });

    // Handle condition nodes — branch based on condition evaluation
    if (fromNode.type === 'condition') {
      const condData = fromNode.data as ConditionNodeData;
      if (transition.branchKey === 'yes' || transition.branchKey === 'true') {
        // The "yes" branch includes the condition node's conditions
        conditions.push(...condData.conditions);
      } else if (transition.branchKey === 'no' || transition.branchKey === 'false') {
        // The "no" branch negates each condition from the node
        for (const cond of condData.conditions) {
          conditions.push({
            field: cond.field,
            operator: negateOperator(cond.operator),
            value: cond.value,
          });
        }
      }
    }

    // Handle delay nodes
    if (fromNode.type === 'delay') {
      const delayData = fromNode.data as DelayNodeData;
      if (delayData.type === 'time' && delayData.minutes) {
        conditions.push({
          field: 'hours_since_updated',
          operator: 'greater_than',
          value: delayData.minutes / 60,
        });
      } else if (delayData.type === 'event' && delayData.event) {
        conditions.push({
          field: 'event',
          operator: 'is',
          value: delayData.event,
        });
      }
    }

    // Add transition-level conditions
    if (transition.conditions) {
      conditions.push(...transition.conditions);
    }

    const actions: RuleAction[] = [];

    // Transition actions
    if (transition.actions) {
      actions.push(...transition.actions);
    }

    // Remove old state tag, add new state tag
    actions.push({ type: 'remove_tag', value: stateTag(wfId, transition.fromNodeId) });
    actions.push({ type: 'add_tag', value: stateTag(wfId, transition.toNodeId) });

    const ruleType = fromNode.type === 'delay' && (fromNode.data as DelayNodeData).type === 'time'
      ? 'automation' as const
      : 'trigger' as const;

    rules.push({
      id: makeRuleId(wfId, `t-${transition.id}`),
      type: ruleType,
      name: `[WF] ${workflow.name}: ${getNodeLabel(fromNode)} → ${getNodeLabel(toNode)}`,
      enabled: workflow.enabled,
      conditions: { all: conditions },
      actions,
    });
  }

  // Process state nodes with onEnterActions
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.type !== 'state') continue;
    const stateData = node.data as StateNodeData;

    if (stateData.onEnterActions?.length) {
      rules.push({
        id: makeRuleId(wfId, `enter-${nodeId}`),
        type: 'trigger',
        name: `[WF] ${workflow.name}: Enter ${stateData.label}`,
        enabled: workflow.enabled,
        conditions: {
          all: [{ field: 'tags', operator: 'contains', value: stateTag(wfId, nodeId) }],
        },
        actions: stateData.onEnterActions,
      });
    }

    // SLA rules
    if (stateData.slaMinutes) {
      rules.push({
        id: makeRuleId(wfId, `sla-${nodeId}`),
        type: 'sla',
        name: `[WF] ${workflow.name}: SLA breach for ${stateData.label}`,
        enabled: workflow.enabled,
        conditions: {
          all: [
            { field: 'tags', operator: 'contains', value: stateTag(wfId, nodeId) },
            { field: 'hours_since_updated', operator: 'greater_than', value: stateData.slaMinutes / 60 },
          ],
        },
        actions: [{ type: 'escalate' }],
      });
    }
  }

  return rules;
}

// ---- Helpers ----

function negateOperator(op: string): string {
  const negations: Record<string, string> = {
    is: 'is_not',
    equals: 'not_equals',
    is_not: 'is',
    not_equals: 'equals',
    contains: 'not_contains',
    not_contains: 'contains',
    greater_than: 'less_than',
    less_than: 'greater_than',
    is_empty: 'is_not_empty',
    is_not_empty: 'is_empty',
    in: 'not_in',
    not_in: 'in',
  };
  return negations[op] || op;
}

export function getNodeLabel(node?: WorkflowNode): string {
  if (!node) return '(unknown)';
  switch (node.type) {
    case 'trigger': return 'Trigger';
    case 'state': return (node.data as StateNodeData).label || 'State';
    case 'condition': return 'Condition';
    case 'action': return 'Action';
    case 'delay': return 'Delay';
    case 'end': return 'End';
    default: return node.type;
  }
}
