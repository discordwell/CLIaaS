"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import CannedResponsePicker from "./CannedResponsePicker";
import MacroButton from "./MacroButton";
import MentionInput from "./MentionInput";
import CollisionWarningModal from "./CollisionWarningModal";

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
  const [collisionWarning, setCollisionWarning] = useState<{
    newReplies: Array<{ author: string; body: string; createdAt: string }>;
  } | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);

  const [status, setStatus] = useState(currentStatus);
  const [priority, setPriority] = useState(currentPriority);
  const [updateState, setUpdateState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [updateMsg, setUpdateMsg] = useState("");

  // SSE-based new reply warning
  const [newReplyBanner, setNewReplyBanner] = useState(false);

  // Typing broadcast
  const lastTypingBroadcast = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingStartedAt = useRef<string | null>(null);

  const broadcastActivity = useCallback(
    (activity: "typing" | "viewing") => {
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, activity }),
      }).catch(() => {});
    },
    [ticketId]
  );

  const handleTyping = useCallback(() => {
    if (!composingStartedAt.current) {
      composingStartedAt.current = new Date().toISOString();
    }
    const now = Date.now();
    if (now - lastTypingBroadcast.current > 3000) {
      lastTypingBroadcast.current = now;
      broadcastActivity("typing");
    }
    // Reset idle timer
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      broadcastActivity("viewing");
    }, 5000);
  }, [broadcastActivity]);

  const handleTextareaFocus = useCallback(() => {
    broadcastActivity("viewing");
  }, [broadcastActivity]);

  const handleTextareaBlur = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    broadcastActivity("viewing");
  }, [broadcastActivity]);

  // Cleanup typing timer on unmount (leave is handled by CollisionDetector)
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [ticketId]);

  // Listen for SSE new reply events (use ref for replyBody to avoid recreating EventSource on every keystroke)
  const replyBodyRef = useRef(replyBody);
  replyBodyRef.current = replyBody;

  useEffect(() => {
    const es = new EventSource(`/api/events?ticketId=${encodeURIComponent(ticketId)}`);
    const handler = (e: MessageEvent) => {
      try {
        if (replyBodyRef.current.trim()) {
          setNewReplyBanner(true);
        }
      } catch { /* ignore */ }
    };
    es.addEventListener("ticket:reply", handler);
    return () => {
      es.removeEventListener("ticket:reply", handler);
      es.close();
    };
  }, [ticketId]);

  const doSendReply = async () => {
    setReplyState("sending");
    setReplyMsg("");
    setCollisionWarning(null);
    try {
      const url = isNote
        ? `/api/tickets/${ticketId}/notes`
        : `/api/tickets/${ticketId}/reply`;
      const payload = isNote
        ? { body: replyBody, mentions: mentionIds.length > 0 ? mentionIds : undefined }
        : { message: replyBody, isNote: false, mentionedUserIds: mentionIds.length > 0 ? mentionIds : undefined };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reply failed");
      setReplyMsg(isNote ? "Note added" : "Reply sent");
      setReplyState("success");
      setReplyBody("");
      composingStartedAt.current = null;
      setNewReplyBanner(false);
    } catch (err) {
      setReplyMsg(err instanceof Error ? err.message : "Failed");
      setReplyState("error");
    }
  };

  const onReply = async () => {
    if (!replyBody.trim()) return;

    // Pre-submit collision check
    if (composingStartedAt.current) {
      try {
        const res = await fetch(
          `/api/tickets/${ticketId}/collision-check?since=${encodeURIComponent(composingStartedAt.current)}`
        );
        const data = await res.json();
        if (data.hasNewReplies && data.newReplies?.length > 0) {
          setCollisionWarning({ newReplies: data.newReplies });
          return;
        }
      } catch {
        // Collision check failed — proceed anyway
      }
    }

    await doSendReply();
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
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Update Ticket</h3>
          <MacroButton ticketId={ticketId} />
        </div>
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

        {/* New reply banner */}
        {newReplyBanner && (
          <div className="mt-3 flex items-center gap-2 border-2 border-amber-400 bg-amber-50 px-4 py-2">
            <svg className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-mono text-xs font-bold text-amber-800">
              Someone just replied to this ticket — you may want to review before sending
            </span>
            <button
              type="button"
              onClick={() => setNewReplyBanner(false)}
              className="ml-auto font-mono text-xs text-amber-600 hover:text-amber-800"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Collision warning modal */}
        {collisionWarning && (
          <CollisionWarningModal
            newReplies={collisionWarning.newReplies}
            onDiscard={() => {
              setCollisionWarning(null);
              setReplyBody("");
              composingStartedAt.current = null;
            }}
            onSendAnyway={() => {
              setCollisionWarning(null);
              void doSendReply();
            }}
            onReview={() => {
              setCollisionWarning(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}

        <div className="mt-4">
          {/* Reply / Note toggle */}
          <div className="mb-3 inline-flex border-2 border-zinc-950">
            <button
              type="button"
              onClick={() => setIsNote(false)}
              className={`px-4 py-1.5 font-mono text-xs font-bold uppercase transition-colors ${
                !isNote
                  ? "bg-zinc-950 text-white"
                  : "bg-white text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              Reply
            </button>
            <button
              type="button"
              onClick={() => setIsNote(true)}
              className={`px-4 py-1.5 font-mono text-xs font-bold uppercase transition-colors ${
                isNote
                  ? "bg-amber-400 text-amber-900"
                  : "bg-white text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              Note
            </button>
          </div>
          {isNote ? (
            <MentionInput
              value={replyBody}
              onChange={(v) => {
                setReplyBody(v);
                handleTyping();
              }}
              onMentionsChange={setMentionIds}
              onFocus={handleTextareaFocus}
              onBlur={handleTextareaBlur}
              onKeyDown={handleTyping}
              placeholder="Add an internal note... (use @name to mention)"
              rows={5}
              className="w-full border-2 border-amber-300 bg-amber-50 p-3 text-sm focus:border-amber-500 focus:outline-none"
            />
          ) : (
            <MentionInput
              value={replyBody}
              onChange={(v) => {
                setReplyBody(v);
                handleTyping();
              }}
              onMentionsChange={setMentionIds}
              onFocus={handleTextareaFocus}
              onBlur={handleTextareaBlur}
              onKeyDown={handleTyping}
              placeholder="Type your reply... (use @name to mention)"
              rows={5}
              className="w-full border-2 border-zinc-300 p-3 text-sm focus:border-zinc-950 focus:outline-none"
            />
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {isNote && (
              <span className="font-mono text-xs font-bold text-amber-700">
                Internal note — not visible to customer
              </span>
            )}
            {!isNote && <div />}
            <div className="flex items-center gap-3">
              <CannedResponsePicker
                ticketId={ticketId}
                onInsert={(text) => setReplyBody((prev) => prev ? prev + "\n" + text : text)}
              />
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
