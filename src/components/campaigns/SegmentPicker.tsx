"use client";

import { useState, useCallback } from "react";

interface SegmentCondition {
  field: string;
  operator: string;
  value: string;
}

interface SegmentPickerProps {
  conditions: SegmentCondition[];
  onChange: (conditions: SegmentCondition[]) => void;
  onPreview?: () => void;
  previewCount?: number | null;
  disabled?: boolean;
}

const FIELDS = [
  { value: "plan", label: "Plan" },
  { value: "email", label: "Email" },
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Created At" },
  { value: "lastSeenAt", label: "Last Seen" },
  { value: "customAttributes.company", label: "Company" },
  { value: "customAttributes.role", label: "Role" },
  { value: "customAttributes.country", label: "Country" },
];

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "not exists" },
  { value: "in", label: "in list" },
];

const NO_VALUE_OPS = new Set(["exists", "not_exists"]);

export default function SegmentPicker({
  conditions,
  onChange,
  onPreview,
  previewCount,
  disabled,
}: SegmentPickerProps) {
  const [localConditions, setLocalConditions] = useState<SegmentCondition[]>(
    conditions.length > 0 ? conditions : [{ field: "plan", operator: "eq", value: "" }]
  );

  const propagate = useCallback(
    (next: SegmentCondition[]) => {
      setLocalConditions(next);
      onChange(next);
    },
    [onChange]
  );

  function updateCondition(index: number, updates: Partial<SegmentCondition>) {
    const next = localConditions.map((c, i) => (i === index ? { ...c, ...updates } : c));
    propagate(next);
  }

  function addCondition() {
    propagate([...localConditions, { field: "plan", operator: "eq", value: "" }]);
  }

  function removeCondition(index: number) {
    if (localConditions.length <= 1) return;
    propagate(localConditions.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs font-bold uppercase text-zinc-500">
          Segment Conditions
        </p>
        {previewCount !== undefined && previewCount !== null && (
          <span className="font-mono text-xs text-zinc-500">
            {previewCount} customer{previewCount !== 1 ? "s" : ""} matched
          </span>
        )}
      </div>

      {localConditions.map((cond, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <span className="font-mono text-xs font-bold text-zinc-400">AND</span>
          )}
          <select
            value={cond.field}
            onChange={(e) => updateCondition(i, { field: e.target.value })}
            disabled={disabled}
            className="border-2 border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-950 disabled:opacity-50"
          >
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            value={cond.operator}
            onChange={(e) => updateCondition(i, { operator: e.target.value })}
            disabled={disabled}
            className="border-2 border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-950 disabled:opacity-50"
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {!NO_VALUE_OPS.has(cond.operator) && (
            <input
              type="text"
              value={cond.value}
              onChange={(e) => updateCondition(i, { value: e.target.value })}
              disabled={disabled}
              placeholder="value"
              className="flex-1 border-2 border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-950 disabled:opacity-50"
            />
          )}

          {localConditions.length > 1 && !disabled && (
            <button
              onClick={() => removeCondition(i)}
              className="font-mono text-xs font-bold text-red-500 hover:text-red-700"
              title="Remove condition"
            >
              x
            </button>
          )}
        </div>
      ))}

      <div className="flex gap-2">
        {!disabled && (
          <button
            onClick={addCondition}
            className="border border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase hover:border-zinc-500"
          >
            + Add Condition
          </button>
        )}
        {onPreview && (
          <button
            onClick={onPreview}
            className="border border-blue-300 bg-blue-50 px-3 py-1 font-mono text-xs font-bold uppercase text-blue-700 hover:bg-blue-100"
          >
            Preview
          </button>
        )}
      </div>
    </div>
  );
}
