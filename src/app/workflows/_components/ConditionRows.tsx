"use client";

import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  FIELD_VALUE_PRESETS,
  OPERATOR_DESCRIPTIONS,
} from "@/lib/automation/constants";
import type { WorkflowCondition } from "./types";

export function ConditionRows({
  label,
  conditions,
  onChange,
}: {
  label: string;
  conditions: WorkflowCondition[];
  onChange: (conditions: WorkflowCondition[]) => void;
}) {
  function addRow() {
    const defaultField = "status";
    const defaultValue = FIELD_VALUE_PRESETS[defaultField]?.[0] ?? "";
    onChange([...conditions, { field: defaultField, operator: "is", value: defaultValue }]);
  }

  function updateRow(idx: number, patch: Partial<WorkflowCondition>) {
    const next = [...conditions];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(conditions.filter((_, i) => i !== idx));
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
      {conditions.map((c, i) => (
        <div key={i} className="mt-1.5 space-y-1 rounded border border-zinc-200 p-1.5">
          <div className="flex gap-1">
            <select
              value={c.field}
              onChange={(e) => updateRow(i, { field: e.target.value })}
              className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
            >
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              value={c.operator}
              onChange={(e) => updateRow(i, { operator: e.target.value })}
              className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
            >
              {CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o} title={OPERATOR_DESCRIPTIONS[o] || o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            {FIELD_VALUE_PRESETS[c.field] ? (
              <select
                value={FIELD_VALUE_PRESETS[c.field].includes(String(c.value ?? "")) ? String(c.value ?? "") : "__custom__"}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    updateRow(i, { value: "" });
                  } else {
                    updateRow(i, { value: e.target.value });
                  }
                }}
                className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
              >
                {FIELD_VALUE_PRESETS[c.field].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
            ) : (
              <input
                type="text"
                value={String(c.value ?? "")}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value"
                className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
              />
            )}
            {/* Show custom input when "Custom..." is selected on a preset field */}
            {FIELD_VALUE_PRESETS[c.field] && !FIELD_VALUE_PRESETS[c.field].includes(String(c.value ?? "")) && (
              <input
                type="text"
                value={String(c.value ?? "")}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="custom value"
                className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
              />
            )}
            <button
              onClick={() => removeRow(i)}
              className="px-1 text-[10px] text-red-400 hover:text-red-600"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
