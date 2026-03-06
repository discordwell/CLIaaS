"use client";

import {
  ROUTING_CONDITION_FIELDS,
  ROUTING_CONDITION_OPERATORS,
  ROUTING_FIELD_VALUE_PRESETS,
} from "@/lib/routing/constants";

export interface ConditionRow {
  field: string;
  operator: string;
  value: unknown;
}

export interface RoutingConditions {
  all: ConditionRow[];
  any: ConditionRow[];
}

interface Props {
  conditions: RoutingConditions;
  onChange: (conditions: RoutingConditions) => void;
}

const selectClass =
  "w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950";
const inputClass = selectClass;

function ConditionGroup({
  group,
  label,
  rows,
  onChange,
}: {
  group: "all" | "any";
  label: string;
  rows: ConditionRow[];
  onChange: (rows: ConditionRow[]) => void;
}) {
  function update(idx: number, patch: Partial<ConditionRow>) {
    const next = rows.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...rows, { field: "status", operator: "is", value: "" }]);
  }

  return (
    <fieldset className="border-2 border-zinc-200 p-4">
      <legend className="px-2 font-mono text-xs font-bold uppercase text-zinc-500">
        {label} <span className="text-zinc-400">({group.toUpperCase()})</span>
      </legend>

      {rows.map((c, i) => {
        const presets = ROUTING_FIELD_VALUE_PRESETS[c.field];
        const noValue = ["is_empty", "is_not_empty"].includes(c.operator);
        return (
          <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
            <select
              value={c.field}
              onChange={(e) => update(i, { field: e.target.value })}
              className={`${selectClass} w-36`}
            >
              {ROUTING_CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </option>
              ))}
            </select>

            <select
              value={c.operator}
              onChange={(e) => update(i, { operator: e.target.value })}
              className={`${selectClass} w-36`}
            >
              {ROUTING_CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o.replace(/_/g, " ")}
                </option>
              ))}
            </select>

            {!noValue &&
              (presets ? (
                <select
                  value={String(c.value ?? "")}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className={`${selectClass} w-36`}
                >
                  <option value="">--</option>
                  {presets.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
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
              ))}

            <button
              type="button"
              onClick={() => remove(i)}
              className="px-2 py-2 font-mono text-xs font-bold text-red-500 hover:text-red-700"
            >
              X
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

export default function RoutingConditionBuilder({ conditions, onChange }: Props) {
  return (
    <div className="mt-4 space-y-4">
      <ConditionGroup
        group="all"
        label="Match ALL"
        rows={conditions.all}
        onChange={(all) => onChange({ ...conditions, all })}
      />
      <ConditionGroup
        group="any"
        label="Match ANY"
        rows={conditions.any}
        onChange={(any) => onChange({ ...conditions, any })}
      />
    </div>
  );
}
