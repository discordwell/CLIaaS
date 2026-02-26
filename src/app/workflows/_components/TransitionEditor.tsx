"use client";

import type { WorkflowTransition, WorkflowNode } from "./types";
import { nodeTypeConfig, getNodeDisplayLabel } from "./types";
import { ConditionRows } from "./ConditionRows";
import { ActionRows } from "./ActionRows";

export function TransitionEditor({
  transition,
  nodes,
  onChange,
}: {
  transition: WorkflowTransition;
  nodes: Record<string, WorkflowNode>;
  onChange: (updated: WorkflowTransition) => void;
}) {
  const fromNode = nodes[transition.fromNodeId];
  const toNode = nodes[transition.toNodeId];

  return (
    <div className="space-y-4">
      <p className="font-mono text-xs font-bold uppercase">Transition</p>

      <div className="space-y-1 text-xs">
        <p className="text-zinc-500">
          <span className="font-bold">From:</span>{" "}
          {fromNode
            ? `${nodeTypeConfig[fromNode.type].label}: ${getNodeDisplayLabel(fromNode)}`
            : transition.fromNodeId}
        </p>
        <p className="text-zinc-500">
          <span className="font-bold">To:</span>{" "}
          {toNode
            ? `${nodeTypeConfig[toNode.type].label}: ${getNodeDisplayLabel(toNode)}`
            : transition.toNodeId}
        </p>
      </div>

      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Label
        </label>
        <input
          type="text"
          value={transition.label || ""}
          onChange={(e) =>
            onChange({ ...transition, label: e.target.value || undefined })
          }
          placeholder="e.g. Approve"
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>

      {fromNode?.type === "condition" && (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Branch Key
          </label>
          <select
            value={transition.branchKey || ""}
            onChange={(e) =>
              onChange({
                ...transition,
                branchKey: e.target.value || undefined,
              })
            }
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          >
            <option value="">None</option>
            <option value="yes">Yes (match)</option>
            <option value="no">No (fallback)</option>
          </select>
        </div>
      )}

      <ConditionRows
        label="Conditions"
        conditions={transition.conditions || []}
        onChange={(conditions) =>
          onChange({
            ...transition,
            conditions: conditions.length > 0 ? conditions : undefined,
          })
        }
      />

      <ActionRows
        label="Actions"
        actions={transition.actions || []}
        onChange={(actions) =>
          onChange({
            ...transition,
            actions: actions.length > 0 ? actions : undefined,
          })
        }
      />
    </div>
  );
}
