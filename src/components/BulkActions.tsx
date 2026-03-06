"use client";

import { useState } from "react";
import TagPicker from "./TagPicker";

interface BulkActionsProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  onRefresh?: () => void;
}

const STATUSES = ["open", "pending", "solved", "closed"];
const PRIORITIES = ["urgent", "high", "normal", "low"];

export default function BulkActions({ selectedIds, onClearSelection, onRefresh }: BulkActionsProps) {
  const [action, setAction] = useState<"tags" | "status" | "priority" | null>(null);
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("normal");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  if (selectedIds.size === 0) return null;

  const ids = Array.from(selectedIds);

  const handleBulkTags = async (addTags?: string[], removeTags?: string[]) => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/tickets/bulk/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketIds: ids, addTags, removeTags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMessage(`Updated ${data.success}/${data.total} tickets`);
      onRefresh?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed");
    }
    setSaving(false);
  };

  const handleBulkUpdate = async (updates: Record<string, string>) => {
    setSaving(true);
    setMessage("");
    let success = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/tickets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (res.ok) success++;
      } catch { /* continue */ }
    }
    setMessage(`Updated ${success}/${ids.length} tickets`);
    setSaving(false);
    onRefresh?.();
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border-2 border-zinc-950 bg-white px-6 py-4 shadow-2xl">
      <div className="flex items-center gap-4">
        <span className="font-mono text-xs font-bold">
          {selectedIds.size} selected
        </span>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAction(action === "tags" ? null : "tags")}
            className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${action === "tags" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 hover:border-zinc-950"}`}
          >
            Tags
          </button>
          <button
            type="button"
            onClick={() => setAction(action === "status" ? null : "status")}
            className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${action === "status" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 hover:border-zinc-950"}`}
          >
            Status
          </button>
          <button
            type="button"
            onClick={() => setAction(action === "priority" ? null : "priority")}
            className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${action === "priority" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 hover:border-zinc-950"}`}
          >
            Priority
          </button>
        </div>

        {action === "tags" && (
          <div className="flex items-center gap-2">
            <BulkTagInput onApply={handleBulkTags} saving={saving} />
          </div>
        )}

        {action === "status" && (
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border border-zinc-300 px-2 py-1 font-mono text-xs"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <button
              type="button"
              onClick={() => handleBulkUpdate({ status })}
              disabled={saving}
              className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold text-white disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}

        {action === "priority" && (
          <div className="flex items-center gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border border-zinc-300 px-2 py-1 font-mono text-xs"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
            <button
              type="button"
              onClick={() => handleBulkUpdate({ priority })}
              disabled={saving}
              className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold text-white disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}

        {message && <span className="font-mono text-xs text-emerald-600">{message}</span>}

        <button
          type="button"
          onClick={onClearSelection}
          className="ml-auto font-mono text-xs text-zinc-400 hover:text-zinc-950"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function BulkTagInput({ onApply, saving }: { onApply: (add?: string[], remove?: string[]) => void; saving: boolean }) {
  const [tagInput, setTagInput] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");

  return (
    <div className="flex items-center gap-2">
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as "add" | "remove")}
        className="border border-zinc-300 px-2 py-1 font-mono text-xs"
      >
        <option value="add">Add</option>
        <option value="remove">Remove</option>
      </select>
      <input
        type="text"
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        placeholder="tag1, tag2..."
        className="w-40 border border-zinc-300 px-2 py-1 font-mono text-xs"
      />
      <button
        type="button"
        onClick={() => {
          const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
          if (tags.length === 0) return;
          if (mode === "add") onApply(tags, undefined);
          else onApply(undefined, tags);
          setTagInput("");
        }}
        disabled={saving || !tagInput.trim()}
        className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold text-white disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  );
}
