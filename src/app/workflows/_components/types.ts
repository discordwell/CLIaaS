/**
 * Client-side workflow types (mirror server types) and shared config.
 */

export type WorkflowNodeType =
  | "trigger"
  | "state"
  | "condition"
  | "action"
  | "delay"
  | "end";

export interface WorkflowCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface WorkflowAction {
  type: string;
  value?: unknown;
  field?: string;
  to?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowTransition {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  conditions?: WorkflowCondition[];
  actions?: WorkflowAction[];
  branchKey?: string;
}

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

export const nodeTypeConfig: Record<
  WorkflowNodeType,
  { label: string; color: string; icon: string; shape: string }
> = {
  trigger: {
    label: "Trigger",
    color: "bg-amber-500",
    icon: "\u26A1",
    shape: "pill",
  },
  state: {
    label: "State",
    color: "bg-blue-500",
    icon: "\u25CB",
    shape: "rect",
  },
  condition: {
    label: "Condition",
    color: "bg-amber-400",
    icon: "?",
    shape: "diamond",
  },
  action: {
    label: "Action",
    color: "bg-emerald-500",
    icon: "\u2699",
    shape: "rect",
  },
  delay: {
    label: "Delay",
    color: "bg-purple-500",
    icon: "\u23F1",
    shape: "rect",
  },
  end: { label: "End", color: "bg-red-500", icon: "\u2716", shape: "circle" },
};

export function getNodeDisplayLabel(node: WorkflowNode): string {
  if (node.type === "state")
    return (node.data as { label?: string }).label || "State";
  if (node.type === "end")
    return (node.data as { label?: string }).label || "End";
  return nodeTypeConfig[node.type].label;
}
