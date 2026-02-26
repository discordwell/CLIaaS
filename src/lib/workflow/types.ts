/**
 * Core types for the visual workflow / blueprint builder.
 *
 * A workflow is a directed graph of nodes connected by transitions.
 * Nodes represent states, conditions, actions, delays, triggers, and end points.
 * Transitions define edges with optional conditions and actions.
 *
 * WorkflowCondition reuses Condition from automation/conditions.ts.
 * WorkflowAction reuses RuleAction from automation/actions.ts.
 */

import type { Condition } from '@/lib/automation/conditions';
import type { RuleAction } from '@/lib/automation/actions';
import type { Rule } from '@/lib/automation/engine';

// Re-export automation types under workflow aliases
export type WorkflowCondition = Condition;
export type WorkflowAction = RuleAction;

// ---- Node types ----

export type WorkflowNodeType = 'trigger' | 'state' | 'condition' | 'action' | 'delay' | 'end';

export interface TriggerNodeData {
  event: string;
  conditions?: WorkflowCondition[];
}

export interface StateNodeData {
  label: string;
  color?: string;
  mandatoryFields?: string[];
  slaMinutes?: number;
  onEnterActions?: WorkflowAction[];
}

export interface ConditionNodeData {
  logic: 'all' | 'any';
  conditions: WorkflowCondition[];
}

export interface ActionNodeData {
  actions: WorkflowAction[];
}

export interface DelayNodeData {
  type: 'time' | 'event';
  minutes?: number;
  event?: string;
}

export interface EndNodeData {
  label?: string;
}

export type WorkflowNodeData =
  | TriggerNodeData
  | StateNodeData
  | ConditionNodeData
  | ActionNodeData
  | DelayNodeData
  | EndNodeData;

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  data: WorkflowNodeData;
  position: { x: number; y: number };
}

// ---- Transitions ----

export interface WorkflowTransition {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  conditions?: WorkflowCondition[];
  actions?: WorkflowAction[];
  /** Branch key for condition nodes (e.g. 'yes' / 'no') */
  branchKey?: string;
}

// ---- Workflow ----

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: Record<string, WorkflowNode>;
  transitions: WorkflowTransition[];
  entryNodeId: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Export format ----

export interface WorkflowExport {
  format: 'cliaas-workflow-v1';
  workflow: Workflow;
  exportedAt: string;
  rules: Rule[];
}
