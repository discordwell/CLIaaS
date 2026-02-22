"use client";

import { useState } from "react";

interface TicketActionsProps {
  ticketId: string;
  currentStatus: string;
  currentPriority: string;
}

const STATUSES = ["open", "pending", "solved", "closed"];
const PRIORITIES = ["urgent", "high", "normal", "low"];

export default function TicketActions({
  ticketId,
  currentStatus,
  currentPriority,
}: TicketActionsProps) {
  const [replyBody, setReplyBody] = useState("");
  const [isNote, setIsNote] = useState(false);
  const [replyState, setReplyState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [replyMsg, setReplyMsg] = useState("");

  const [status, setStatus] = useState(currentStatus);
  const [priority, setPriority] = useState(currentPriority);
  const [updateState, setUpdateState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [updateMsg, setUpdateMsg] = useState("");

  const onReply = async () => {
    if (!replyBody.trim()) return;
    setReplyState("sending");
    setReplyMsg("");
    try {
      const res = await fetch(`/api/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyBody, isNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reply failed");
      setReplyMsg(isNote ? "Note added" : "Reply sent");
      setReplyState("success");
      setReplyBody("");
    } catch (err) {
      setReplyMsg(err instanceof Error ? err.message : "Failed");
      setReplyState("error");
    }
  };

  const onUpdate = async () => {
    if (status === currentStatus && priority === currentPriority) return;
    setUpdateState("saving");
    setUpdateMsg("");
    try {
      const updates: Record<string, string> = {};
      if (status !== currentStatus) updates.status = status;
      if (priority !== currentPriority) updates.priority = priority;

      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setUpdateMsg("Updated");
      setUpdateState("success");
    } catch (err) {
      setUpdateMsg(err instanceof Error ? err.message : "Failed");
      setUpdateState("error");
    }
  };

  return (
    <>
      {/* STATUS & PRIORITY UPDATE */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="text-lg font-bold">Update Ticket</h3>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 border-2 border-zinc-950 bg-white px-3 py-2 font-mono text-sm font-bold"
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-1 border-2 border-zinc-950 bg-white px-3 py-2 font-mono text-sm font-bold"
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onUpdate}
            disabled={updateState === "saving" || (status === currentStatus && priority === currentPriority)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {updateState === "saving" ? "Saving..." : "Save Changes"}
          </button>
          {updateMsg && (
            <span className={`font-mono text-xs ${updateState === "error" ? "text-red-600" : "text-emerald-600"}`}>
              {updateMsg}
            </span>
          )}
        </div>
      </section>

      {/* REPLY FORM */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="text-lg font-bold">Reply</h3>
        <div className="mt-4">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Type your reply..."
            rows={5}
            className="w-full border-2 border-zinc-300 p-3 text-sm focus:border-zinc-950 focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 font-mono text-xs font-bold text-zinc-600">
              <input
                type="checkbox"
                checked={isNote}
                onChange={(e) => setIsNote(e.target.checked)}
                className="h-4 w-4"
              />
              Internal note (not visible to customer)
            </label>
            <div className="flex items-center gap-3">
              {replyMsg && (
                <span className={`font-mono text-xs ${replyState === "error" ? "text-red-600" : "text-emerald-600"}`}>
                  {replyMsg}
                </span>
              )}
              <button
                type="button"
                onClick={onReply}
                disabled={replyState === "sending" || !replyBody.trim()}
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {replyState === "sending" ? "Sending..." : isNote ? "Add Note" : "Send Reply"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
