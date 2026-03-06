"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ViewCondition, ViewConditionOperator, ViewCombineMode, ViewSort, ViewQuery } from "@/lib/views/types";

const FIELDS = [
  { value: "status", label: "Status", type: "select", options: ["open", "pending", "on_hold", "solved", "closed"] },
  { value: "priority", label: "Priority", type: "select", options: ["low", "normal", "high", "urgent"] },
  { value: "assignee", label: "Assignee", type: "text" },
  { value: "requester", label: "Requester", type: "text" },
  { value: "tag", label: "Tag", type: "text" },
  { value: "source", label: "Source", type: "text" },
  { value: "subject", label: "Subject", type: "text" },
  { value: "created_at", label: "Created At", type: "date" },
  { value: "updated_at", label: "Updated At", type: "date" },
];

const OPERATORS: { value: ViewConditionOperator; label: string; needsValue: boolean }[] = [
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "not_contains", label: "does not contain", needsValue: true },
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
  { value: "greater_than", label: "greater than", needsValue: true },
  { value: "less_than", label: "less than", needsValue: true },
];

const SORT_FIELDS = [
  { value: "created_at", label: "Created At" },
  { value: "updated_at", label: "Updated At" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "subject", label: "Subject" },
];

interface ViewBuilderProps {
  initialQuery?: ViewQuery;
  onQueryChange?: (query: ViewQuery) => void;
  showPreview?: boolean;
}

export default function ViewBuilder({ initialQuery, onQueryChange, showPreview = true }: ViewBuilderProps) {
  const [conditions, setConditions] = useState<ViewCondition[]>(
    initialQuery?.conditions ?? [{ field: "status", operator: "is", value: "open" }]
  );
  const [combineMode, setCombineMode] = useState<ViewCombineMode>(initialQuery?.combineMode ?? "and");
  const [sort, setSort] = useState<ViewSort>(initialQuery?.sort ?? { field: "updated_at", direction: "desc" });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const buildQuery = useCallback((): ViewQuery => ({
    conditions,
    combineMode,
    sort,
  }), [conditions, combineMode, sort]);

  useEffect(() => {
    onQueryChange?.(buildQuery());
  }, [conditions, combineMode, sort, onQueryChange, buildQuery]);

  // Live preview count
  useEffect(() => {
    if (!showPreview) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const query = buildQuery();
        const res = await fetch("/api/views/preview-count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setPreviewCount(data.count ?? null);
      } catch {
        setPreviewCount(null);
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [conditions, combineMode, sort, showPreview, buildQuery]);

  const updateCondition = (idx: number, updates: Partial<ViewCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, { field: "status", operator: "is", value: "" }]);
  };

  const removeCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setConditions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const needsValue = (op: ViewConditionOperator) =>
    OPERATORS.find((o) => o.value === op)?.needsValue ?? true;

  return (
    <div className="space-y-6">
      {/* Combine Mode */}
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs font-bold uppercase text-zinc-500">Match</span>
        <label className="flex items-center gap-1.5 font-mono text-xs">
          <input
            type="radio"
            checked={combineMode === "and"}
            onChange={() => setCombineMode("and")}
            className="accent-zinc-950"
          />
          ALL conditions
        </label>
        <label className="flex items-center gap-1.5 font-mono text-xs">
          <input
            type="radio"
            checked={combineMode === "or"}
            onChange={() => setCombineMode("or")}
            className="accent-zinc-950"
          />
          ANY condition
        </label>
        {showPreview && previewCount !== null && (
          <span className="ml-auto border border-zinc-300 px-2 py-0.5 font-mono text-xs font-bold">
            {previewCount} ticket{previewCount !== 1 ? "s" : ""} match
          </span>
        )}
      </div>

      {/* Conditions */}
      <div className="space-y-2">
        {conditions.map((cond, idx) => {
          const fieldDef = FIELDS.find((f) => f.value === cond.field);
          const invalid = needsValue(cond.operator) && !cond.value?.trim();

          return (
            <div
              key={idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 border-2 p-2 ${invalid ? "border-red-400 bg-red-50" : "border-zinc-950 bg-white"} ${dragIdx === idx ? "opacity-50" : ""}`}
            >
              <span className="cursor-grab font-mono text-xs text-zinc-400" title="Drag to reorder">
                &#8942;&#8942;
              </span>

              <select
                value={cond.field}
                onChange={(e) => updateCondition(idx, { field: e.target.value })}
                className="border border-zinc-300 px-2 py-1 font-mono text-xs"
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              <select
                value={cond.operator}
                onChange={(e) => updateCondition(idx, { operator: e.target.value as ViewConditionOperator })}
                className="border border-zinc-300 px-2 py-1 font-mono text-xs"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {needsValue(cond.operator) && (
                fieldDef?.type === "select" ? (
                  <select
                    value={cond.value ?? ""}
                    onChange={(e) => updateCondition(idx, { value: e.target.value })}
                    className="flex-1 border border-zinc-300 px-2 py-1 font-mono text-xs"
                  >
                    <option value="">Select...</option>
                    {fieldDef.options?.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={fieldDef?.type === "date" ? "date" : "text"}
                    value={cond.value ?? ""}
                    onChange={(e) => updateCondition(idx, { value: e.target.value })}
                    placeholder="Value..."
                    className="flex-1 border border-zinc-300 px-2 py-1 font-mono text-xs"
                  />
                )
              )}

              <button
                type="button"
                onClick={() => removeCondition(idx)}
                className="font-mono text-xs text-zinc-400 hover:text-red-600"
                title="Remove condition"
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCondition}
        className="border-2 border-dashed border-zinc-300 px-4 py-2 font-mono text-xs text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
      >
        + Add Condition
      </button>

      {/* Sort */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs font-bold uppercase text-zinc-500">Sort by</span>
        <select
          value={sort.field}
          onChange={(e) => setSort((s) => ({ ...s, field: e.target.value }))}
          className="border border-zinc-300 px-2 py-1 font-mono text-xs"
        >
          {SORT_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSort((s) => ({ ...s, direction: s.direction === "asc" ? "desc" : "asc" }))}
          className="border border-zinc-300 px-2 py-1 font-mono text-xs hover:bg-zinc-100"
        >
          {sort.direction === "asc" ? "ASC" : "DESC"}
        </button>
      </div>
    </div>
  );
}
