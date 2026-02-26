/**
 * Starter workflow templates for the visual builder.
 * Each returns a complete Workflow with pre-positioned nodes.
 */

import type { Workflow, WorkflowNode, WorkflowTransition } from './types';

function makeId(): string {
  return crypto.randomUUID();
}

function template(
  name: string,
  description: string,
  nodes: Record<string, WorkflowNode>,
  transitions: WorkflowTransition[],
  entryNodeId: string,
): Workflow {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    name,
    description,
    nodes,
    transitions,
    entryNodeId,
    enabled: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Simple Lifecycle: Trigger → New → Triage → In Progress → Waiting → Resolved → Closed
 */
export function simpleLifecycle(): Workflow {
  const ids = {
    trigger: makeId(),
    new: makeId(),
    triage: makeId(),
    inProgress: makeId(),
    waiting: makeId(),
    resolved: makeId(),
    closed: makeId(),
  };

  const nodes: Record<string, WorkflowNode> = {
    [ids.trigger]: {
      id: ids.trigger,
      type: 'trigger',
      data: { event: 'create' },
      position: { x: 300, y: 40 },
    },
    [ids.new]: {
      id: ids.new,
      type: 'state',
      data: { label: 'New', color: 'bg-blue-500' },
      position: { x: 300, y: 140 },
    },
    [ids.triage]: {
      id: ids.triage,
      type: 'state',
      data: { label: 'Triage', color: 'bg-amber-500' },
      position: { x: 300, y: 240 },
    },
    [ids.inProgress]: {
      id: ids.inProgress,
      type: 'state',
      data: { label: 'In Progress', color: 'bg-emerald-500' },
      position: { x: 300, y: 340 },
    },
    [ids.waiting]: {
      id: ids.waiting,
      type: 'state',
      data: { label: 'Waiting', color: 'bg-purple-500' },
      position: { x: 300, y: 440 },
    },
    [ids.resolved]: {
      id: ids.resolved,
      type: 'state',
      data: { label: 'Resolved', color: 'bg-teal-500' },
      position: { x: 300, y: 540 },
    },
    [ids.closed]: {
      id: ids.closed,
      type: 'end',
      data: { label: 'Closed' },
      position: { x: 300, y: 640 },
    },
  };

  const transitions: WorkflowTransition[] = [
    { id: makeId(), fromNodeId: ids.trigger, toNodeId: ids.new },
    { id: makeId(), fromNodeId: ids.new, toNodeId: ids.triage, label: 'Review' },
    { id: makeId(), fromNodeId: ids.triage, toNodeId: ids.inProgress, label: 'Assign' },
    { id: makeId(), fromNodeId: ids.inProgress, toNodeId: ids.waiting, label: 'Waiting on customer' },
    { id: makeId(), fromNodeId: ids.waiting, toNodeId: ids.inProgress, label: 'Customer replied' },
    { id: makeId(), fromNodeId: ids.inProgress, toNodeId: ids.resolved, label: 'Resolve' },
    { id: makeId(), fromNodeId: ids.resolved, toNodeId: ids.closed, label: 'Close' },
    { id: makeId(), fromNodeId: ids.resolved, toNodeId: ids.inProgress, label: 'Reopen' },
  ];

  return template(
    'Simple Lifecycle',
    'Standard ticket lifecycle: New → Triage → In Progress → Waiting → Resolved → Closed',
    nodes,
    transitions,
    ids.trigger,
  );
}

/**
 * Escalation Pipeline: Trigger → condition(priority=urgent?) →
 *   [yes: Immediate Assign] / [no: Queue] → In Progress → Resolved
 */
export function escalationPipeline(): Workflow {
  const ids = {
    trigger: makeId(),
    checkPriority: makeId(),
    immediate: makeId(),
    queue: makeId(),
    inProgress: makeId(),
    resolved: makeId(),
  };

  const nodes: Record<string, WorkflowNode> = {
    [ids.trigger]: {
      id: ids.trigger,
      type: 'trigger',
      data: { event: 'create' },
      position: { x: 300, y: 40 },
    },
    [ids.checkPriority]: {
      id: ids.checkPriority,
      type: 'condition',
      data: {
        logic: 'any',
        conditions: [{ field: 'priority', operator: 'is', value: 'urgent' }],
      },
      position: { x: 300, y: 160 },
    },
    [ids.immediate]: {
      id: ids.immediate,
      type: 'action',
      data: {
        actions: [
          { type: 'set_priority', value: 'urgent' },
          { type: 'add_tag', value: 'escalated' },
        ],
      },
      position: { x: 120, y: 300 },
    },
    [ids.queue]: {
      id: ids.queue,
      type: 'state',
      data: { label: 'Queue', color: 'bg-zinc-400' },
      position: { x: 480, y: 300 },
    },
    [ids.inProgress]: {
      id: ids.inProgress,
      type: 'state',
      data: { label: 'In Progress', color: 'bg-emerald-500' },
      position: { x: 300, y: 440 },
    },
    [ids.resolved]: {
      id: ids.resolved,
      type: 'end',
      data: { label: 'Resolved' },
      position: { x: 300, y: 560 },
    },
  };

  const transitions: WorkflowTransition[] = [
    { id: makeId(), fromNodeId: ids.trigger, toNodeId: ids.checkPriority },
    { id: makeId(), fromNodeId: ids.checkPriority, toNodeId: ids.immediate, label: 'Urgent', branchKey: 'yes' },
    { id: makeId(), fromNodeId: ids.checkPriority, toNodeId: ids.queue, label: 'Normal', branchKey: 'no' },
    { id: makeId(), fromNodeId: ids.immediate, toNodeId: ids.inProgress },
    { id: makeId(), fromNodeId: ids.queue, toNodeId: ids.inProgress, label: 'Pick up' },
    { id: makeId(), fromNodeId: ids.inProgress, toNodeId: ids.resolved, label: 'Resolve' },
  ];

  return template(
    'Escalation Pipeline',
    'Route urgent tickets to immediate assignment, others to a queue',
    nodes,
    transitions,
    ids.trigger,
  );
}

/**
 * SLA-Driven: Trigger → New(1h SLA) → In Progress(4h SLA) → Escalated → Resolved
 */
export function slaDriven(): Workflow {
  const ids = {
    trigger: makeId(),
    new: makeId(),
    inProgress: makeId(),
    escalated: makeId(),
    resolved: makeId(),
  };

  const nodes: Record<string, WorkflowNode> = {
    [ids.trigger]: {
      id: ids.trigger,
      type: 'trigger',
      data: { event: 'create' },
      position: { x: 300, y: 40 },
    },
    [ids.new]: {
      id: ids.new,
      type: 'state',
      data: { label: 'New', color: 'bg-blue-500', slaMinutes: 60 },
      position: { x: 300, y: 160 },
    },
    [ids.inProgress]: {
      id: ids.inProgress,
      type: 'state',
      data: { label: 'In Progress', color: 'bg-emerald-500', slaMinutes: 240 },
      position: { x: 300, y: 300 },
    },
    [ids.escalated]: {
      id: ids.escalated,
      type: 'state',
      data: { label: 'Escalated', color: 'bg-red-500' },
      position: { x: 300, y: 440 },
    },
    [ids.resolved]: {
      id: ids.resolved,
      type: 'end',
      data: { label: 'Resolved' },
      position: { x: 300, y: 560 },
    },
  };

  const transitions: WorkflowTransition[] = [
    { id: makeId(), fromNodeId: ids.trigger, toNodeId: ids.new },
    { id: makeId(), fromNodeId: ids.new, toNodeId: ids.inProgress, label: 'Assign' },
    { id: makeId(), fromNodeId: ids.inProgress, toNodeId: ids.escalated, label: 'Escalate' },
    { id: makeId(), fromNodeId: ids.inProgress, toNodeId: ids.resolved, label: 'Resolve' },
    { id: makeId(), fromNodeId: ids.escalated, toNodeId: ids.resolved, label: 'Resolve' },
  ];

  return template(
    'SLA-Driven',
    'Ticket lifecycle with SLA timers: 1h for triage, 4h for resolution',
    nodes,
    transitions,
    ids.trigger,
  );
}

/** All available templates. */
export const workflowTemplates = [
  { key: 'simple-lifecycle', label: 'Simple Lifecycle', create: simpleLifecycle },
  { key: 'escalation-pipeline', label: 'Escalation Pipeline', create: escalationPipeline },
  { key: 'sla-driven', label: 'SLA-Driven', create: slaDriven },
] as const;
