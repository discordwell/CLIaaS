"use client";

import { useState } from "react";

interface TicketSplitBarProps {
  ticketId: string;
  ticketSubject: string;
  selectedMessageIds: string[];
  onSplitComplete: () => void;
}

export default function TicketSplitBar({
  ticketId,
  ticketSubject,
  selectedMessageIds,
  onSplitComplete,
}: TicketSplitBarProps) {
  const [newSubject, setNewSubject] = useState(`Split from: ${ticketSubject}`);
  const [showConfirm, setShowConfirm] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (selectedMessageIds.length === 0) return null;

  async function handleSplit() {
    setSplitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageIds: selectedMessageIds,
          newSubject: newSubject.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Split failed");
      } else {
        setShowConfirm(false);
        onSplitComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Split failed");
    } finally {
      setSplitting(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-zinc-950 bg-indigo-950 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-indigo-300">
              {selectedMessageIds.length} message(s) selected for split
            </span>
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            className="border-2 border-white bg-white px-4 py-2 font-mono text-xs font-bold uppercase text-indigo-950 hover:bg-indigo-100"
          >
            Split into New Ticket
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md border-2 border-zinc-950 bg-white p-8">
            <h3 className="text-lg font-bold">Split Messages</h3>
            <p className="mt-2 text-sm text-zinc-600">
              Move {selectedMessageIds.length} message(s) to a new ticket.
            </p>
            <div className="mt-4">
              <label className="font-mono text-xs font-bold uppercase text-zinc-500">
                New Ticket Subject
              </label>
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              />
            </div>
            {error && (
              <p className="mt-2 text-sm font-bold text-red-600">{error}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={splitting}
                className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSplit}
                disabled={splitting}
                className="border-2 border-indigo-900 bg-indigo-900 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-indigo-800 disabled:opacity-50"
              >
                {splitting ? "Splitting..." : "Confirm Split"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
