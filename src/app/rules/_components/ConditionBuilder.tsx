"use client";

import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  FIELD_VALUE_PRESETS,
} from "@/lib/automation/constants";

export interface ConditionRow {
  field: string;
  operator: string;
  value: unknown;
}

interface Props {
  group: "all" | "any";
  label: string;
  conditions: ConditionRow[];
  onChange: (conditions: ConditionRow[]) => void;
}

const selectClass =
  "w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950";
const inputClass = selectClass;

export default function ConditionBuilder({ group, label, conditions, onChange }: Props) {
  function update(idx: number, patch: Partial<ConditionRow>) {
    const next = conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(conditions.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...conditions, { field: "status", operator: "is", value: "" }]);
  }

  return (
    <fieldset className="border-2 border-zinc-200 p-4">
      <legend className="px-2 font-mono text-xs font-bold uppercase text-zinc-500">
        {label} <span className="text-zinc-400">({group.toUpperCase()})</span>
      </legend>

      {conditions.map((c, i) => {
        const presets = FIELD_VALUE_PRESETS[c.field];
        const noValue = ["is_empty", "is_not_empty", "changed"].includes(c.operator);
        return (
          <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
            <select
              value={c.field}
              onChange={(e) => update(i, { field: e.target.value })}
              className={`${selectClass} w-36`}
            >
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>{f.replace(/_/g, " ")}</option>
              ))}
            </select>

            <select
              value={c.operator}
              onChange={(e) => update(i, { operator: e.target.value })}
              className={`${selectClass} w-36`}
            >
              {CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
              ))}
            </select>

            {!noValue && (
              presets ? (
                <select
                  value={String(c.value ?? "")}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className={`${selectClass} w-36`}
                >
                  <option value="">—</option>
                  {presets.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={String(c.value ?? "")}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className={`${inputClass} w-36`}
                  placeholder="value"
                />
              )
            )}

            <button
              type="button"
              onClick={() => remove(i)}
              className="px-2 py-2 font-mono text-xs font-bold text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="mt-3 border border-dashed border-zinc-400 px-3 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
      >
        + condition
      </button>
    </fieldset>
  );
}
