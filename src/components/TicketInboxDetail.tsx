"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { TicketRow } from "./TicketInbox";

interface Message {
  id: string;
  author: string;
  type: string;
  body: string;
  createdAt: string;
  visibility?: string;
}

interface TicketInboxDetailProps {
  ticketId: string;
  ticket: TicketRow;
}

const statusColor: Record<string, string> = {
  open: "bg-emerald-400 text-zinc-950",
  pending: "bg-yellow-400 text-zinc-950",
  solved: "bg-zinc-200 text-zinc-700",
  closed: "bg-zinc-200 text-zinc-700",
};

const priorityColor: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-400 text-zinc-950",
  normal: "bg-zinc-200 text-zinc-700",
  low: "bg-zinc-200 text-zinc-700",
};

const STATUSES = ["open", "pending", "solved", "closed"];

export default function TicketInboxDetail({
  ticketId,
  ticket,
}: TicketInboxDetailProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reply state
  const [replyBody, setReplyBody] = useState("");
  const [isNote, setIsNote] = useState(false);
  const [sendState, setSendState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [sendMsg, setSendMsg] = useState("");

  // Status update state
  const [statusUpdate, setStatusUpdate] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  // Fetch messages when ticketId changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setReplyBody("");
    setSendState("idle");
    setSendMsg("");
    setStatusUpdate(null);

    fetch(`/api/tickets/${ticketId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load messages");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const handleSendReply = useCallback(async () => {
    if (!replyBody.trim()) return;
    setSendState("sending");
    setSendMsg("");

    try {
      const url = isNote
        ? `/api/tickets/${ticketId}/notes`
        : `/api/tickets/${ticketId}/reply`;
      const payload = isNote
        ? { body: replyBody }
        : { message: replyBody, isNote: false };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reply failed");

      setSendMsg(isNote ? "Note added" : "Reply sent");
      setSendState("success");
      setReplyBody("");

      // Refresh messages
      const msgRes = await fetch(`/api/tickets/${ticketId}/messages`);
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setMessages(msgData.messages ?? []);
      }
    } catch (err) {
      setSendMsg(err instanceof Error ? err.message : "Failed");
      setSendState("error");
    }
  }, [ticketId, replyBody, isNote]);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setStatusSaving(true);
      try {
        const res = await fetch(`/api/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Update failed");
        }
        setStatusUpdate(newStatus);
      } catch {
        // Status update failed silently
      } finally {
        setStatusSaving(false);
      }
    },
    [ticketId]
  );

  const currentStatus = statusUpdate ?? ticket.status;

  return (
    <div className="flex h-full flex-col font-mono">
      {/* Detail header */}
      <div className="flex-shrink-0 border-b-2 border-line bg-panel px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-foreground">
              {ticket.subject}
            </h2>
            <p className="mt-1 text-xs text-muted">
              #{ticket.externalId} &middot; {ticket.source} &middot;{" "}
              {ticket.requester}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                statusColor[currentStatus] ?? "bg-zinc-200 text-zinc-700"
              }`}
            >
              {currentStatus}
            </span>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase ${
                priorityColor[ticket.priority] ?? "bg-zinc-200 text-zinc-700"
              }`}
            >
              {ticket.priority}
            </span>
          </div>
        </div>

        {/* Metadata row */}
        <div className="mt-3 flex items-center gap-6 text-[10px] uppercase tracking-wider text-muted">
          <div>
            <span className="font-bold">Assignee:</span>{" "}
            {ticket.assignee ?? "Unassigned"}
          </div>
          <div>
            <span className="font-bold">Created:</span>{" "}
            {new Date(ticket.createdAt).toLocaleDateString()}
          </div>
          <div>
            <span className="font-bold">Updated:</span>{" "}
            {new Date(ticket.updatedAt).toLocaleDateString()}
          </div>
          <Link
            href={`/tickets/${ticket.id}`}
            className="ml-auto font-bold text-foreground hover:underline"
          >
            Open full page &rarr;
          </Link>
        </div>
      </div>

      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto bg-background">
        {loading ? (
          <div className="space-y-4 p-6" data-testid="loading-skeleton">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 bg-zinc-200" />
                  <div className="h-3 w-24 bg-zinc-200" />
                  <div className="h-3 w-16 bg-zinc-100" />
                </div>
                <div className="ml-10 h-3 w-3/4 bg-zinc-100" />
                <div className="ml-10 h-3 w-1/2 bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-red-600">{error}</div>
        ) : messages.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            No messages in this thread.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {messages.map((msg, idx) => (
              <div
                key={msg.id}
                className={`px-6 py-4 ${
                  msg.type === "note"
                    ? "border-l-4 border-amber-400 bg-amber-50/60"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center bg-zinc-950 text-[10px] font-bold text-white">
                      {msg.type === "system"
                        ? "S"
                        : msg.author.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-foreground">
                      {msg.type === "system" ? "System" : msg.author}
                    </span>
                    <span className="text-[10px] text-muted">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted">#{idx + 1}</span>
                    {msg.type === "note" && (
                      <span className="bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        Note
                      </span>
                    )}
                    {msg.type === "system" && (
                      <span className="bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                        System
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 ml-9 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                  {msg.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions footer */}
      <div className="flex-shrink-0 border-t-2 border-line bg-panel">
        {/* Status change buttons */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Status:
          </span>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={statusSaving || currentStatus === s}
              onClick={() => handleStatusChange(s)}
              className={`border px-2 py-0.5 text-[10px] font-bold uppercase transition-colors disabled:opacity-40 ${
                currentStatus === s
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-panel text-muted hover:border-zinc-950"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Reply area */}
        <div className="px-4 py-3">
          <div className="mb-2 inline-flex border border-zinc-300">
            <button
              type="button"
              onClick={() => setIsNote(false)}
              className={`px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
                !isNote
                  ? "bg-zinc-950 text-white"
                  : "bg-panel text-muted hover:bg-zinc-100"
              }`}
            >
              Reply
            </button>
            <button
              type="button"
              onClick={() => setIsNote(true)}
              className={`px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
                isNote
                  ? "bg-amber-400 text-amber-900"
                  : "bg-panel text-muted hover:bg-zinc-100"
              }`}
            >
              Note
            </button>
          </div>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder={
              isNote
                ? "Add an internal note..."
                : "Type your reply..."
            }
            rows={3}
            className={`w-full resize-none border-2 p-2 text-sm focus:outline-none ${
              isNote
                ? "border-amber-300 bg-amber-50 focus:border-amber-500"
                : "border-zinc-300 bg-white focus:border-zinc-950"
            }`}
            data-testid="reply-textarea"
          />
          <div className="mt-2 flex items-center justify-between">
            {isNote && (
              <span className="text-[10px] font-bold text-amber-700">
                Internal note -- not visible to customer
              </span>
            )}
            {!isNote && <div />}
            <div className="flex items-center gap-2">
              {sendMsg && (
                <span
                  className={`text-[10px] ${
                    sendState === "error" ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {sendMsg}
                </span>
              )}
              <button
                type="button"
                onClick={handleSendReply}
                disabled={sendState === "sending" || !replyBody.trim()}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 text-[10px] font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                data-testid="send-reply-btn"
              >
                {sendState === "sending"
                  ? "Sending..."
                  : isNote
                    ? "Add Note"
                    : "Send Reply"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
