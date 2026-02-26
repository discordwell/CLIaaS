"use client";

import { ACTION_TYPES } from "@/lib/automation/constants";
import type { WorkflowAction } from "./types";

export function ActionRows({
  label,
  actions,
  onChange,
}: {
  label: string;
  actions: WorkflowAction[];
  onChange: (actions: WorkflowAction[]) => void;
}) {
  function addRow() {
    onChange([...actions, { type: "add_tag", value: "" }]);
  }

  function updateRow(idx: number, patch: Partial<WorkflowAction>) {
    const next = [...actions];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(actions.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-bold uppercase text-zinc-500">
          {label}
        </label>
        <button
          onClick={addRow}
          className="font-mono text-[10px] font-bold text-zinc-400 hover:text-zinc-950"
        >
          + Add
        </button>
      </div>
      {actions.map((a, i) => (
        <div key={i} className="mt-1.5 flex gap-1 rounded border border-zinc-200 p-1.5">
          <select
            value={a.type}
            onChange={(e) => updateRow(i, { type: e.target.value })}
            className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={String(a.value ?? "")}
            onChange={(e) => updateRow(i, { value: e.target.value })}
            placeholder="value"
            className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
          />
          <button
            onClick={() => removeRow(i)}
            className="px-1 text-[10px] text-red-400 hover:text-red-600"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
