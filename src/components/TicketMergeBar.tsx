"use client";

import { useState } from "react";

interface TicketMergeBarProps {
  selectedIds: string[];
  onMergeComplete: () => void;
}

export default function TicketMergeBar({ selectedIds, onMergeComplete }: TicketMergeBarProps) {
  const [primaryId, setPrimaryId] = useState(selectedIds[0]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (selectedIds.length < 2) return null;

  async function handleMerge() {
    setMerging(true);
    setError(null);
    try {
      const mergedTicketIds = selectedIds.filter((id) => id !== primaryId);
      const res = await fetch("/api/tickets/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryTicketId: primaryId, mergedTicketIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Merge failed");
      } else {
        setShowConfirm(false);
        onMergeComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-zinc-950 bg-zinc-950 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
              {selectedIds.length} tickets selected
            </span>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 font-mono text-xs">
              <span className="text-zinc-400">Primary:</span>
              <select
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
                className="border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-white"
              >
                {selectedIds.map((id) => (
                  <option key={id} value={id}>
                    {id.slice(0, 12)}...
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => setShowConfirm(true)}
              className="border-2 border-white bg-white px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-200"
            >
              Merge Tickets
            </button>
          </div>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md border-2 border-zinc-950 bg-white p-8">
            <h3 className="text-lg font-bold">Confirm Merge</h3>
            <p className="mt-2 text-sm text-zinc-600">
              Merge {selectedIds.length - 1} ticket(s) into the primary ticket?
              Messages will be consolidated and secondary tickets closed.
            </p>
            <p className="mt-2 font-mono text-xs text-zinc-500">
              Primary: {primaryId.slice(0, 12)}...
            </p>
            {error && (
              <p className="mt-2 text-sm font-bold text-red-600">{error}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={merging}
                className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={merging}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {merging ? "Merging..." : "Confirm Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
