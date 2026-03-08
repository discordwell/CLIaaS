"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

interface TicketData {
  id: string;
  externalId: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  requester: string;
  assignee?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MessageData {
  id: string;
  author: string;
  type: string;
  body: string;
  createdAt: string;
}

const priorityColor: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-400 text-black",
  normal: "bg-yellow-300 text-black",
  low: "bg-zinc-300 text-black",
};

const statusColor: Record<string, string> = {
  open: "bg-blue-500 text-white",
  pending: "bg-amber-400 text-black",
  solved: "bg-emerald-500 text-white",
  closed: "bg-zinc-500 text-white",
};

interface TicketDrawerProps {
  ticketId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function TicketDrawer({
  ticketId,
  isOpen,
  onClose,
}: TicketDrawerProps) {
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick action state
  const [replyBody, setReplyBody] = useState("");
  const [replyState, setReplyState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [statusUpdate, setStatusUpdate] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);

  // Fetch ticket data when drawer opens
  useEffect(() => {
    if (!ticketId || !isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setReplyBody("");
    setReplyState("idle");
    setStatusUpdate(null);

    fetch(`/api/tickets/${ticketId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load ticket");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTicket(data.ticket);
        setMessages(data.messages ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? "Failed to load ticket");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticketId, isOpen]);

  // Scroll to bottom of thread when messages load
  useEffect(() => {
    if (messages.length > 0 && threadEndRef.current?.scrollIntoView) {
      threadEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleReply = useCallback(async () => {
    if (!replyBody.trim() || !ticketId) return;
    setReplyState("sending");
    try {
      const res = await fetch(`/api/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyBody, isNote: false }),
      });
      if (!res.ok) throw new Error("Reply failed");
      setReplyState("success");
      setReplyBody("");
      // Re-fetch messages
      const updated = await fetch(`/api/tickets/${ticketId}`);
      if (updated.ok) {
        const data = await updated.json();
        setMessages(data.messages ?? []);
      }
      setTimeout(() => setReplyState("idle"), 2000);
    } catch {
      setReplyState("error");
      setTimeout(() => setReplyState("idle"), 3000);
    }
  }, [replyBody, ticketId]);

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!ticketId) return;
      setUpdatingStatus(true);
      try {
        const res = await fetch(`/api/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Update failed");
        setTicket((prev) => (prev ? { ...prev, status: newStatus } : prev));
        setStatusUpdate("Updated");
        setTimeout(() => setStatusUpdate(null), 2000);
      } catch {
        setStatusUpdate("Failed");
        setTimeout(() => setStatusUpdate(null), 3000);
      } finally {
        setUpdatingStatus(false);
      }
    },
    [ticketId],
  );

  // Determine if the drawer should render at all (for animation)
  const shouldRender = isOpen || ticket !== null;
  if (!shouldRender && !isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l-2 border-line bg-panel shadow-2xl transition-transform duration-200 ease-out sm:w-[60vw] lg:w-[55vw] xl:w-[50vw] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Ticket details"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b-2 border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="h-6 w-48 animate-pulse bg-accent-soft" />
            ) : ticket ? (
              <h2 className="truncate font-mono text-lg font-bold">
                {ticket.subject}
              </h2>
            ) : error ? (
              <h2 className="font-mono text-lg font-bold text-red-600">
                Error
              </h2>
            ) : null}
          </div>
          <div className="ml-4 flex items-center gap-2">
            {ticket && (
              <Link
                href={`/tickets/${ticket.id}`}
                className="border-2 border-line px-3 py-1.5 font-mono text-xs font-bold uppercase transition-colors hover:bg-accent-soft"
                onClick={onClose}
              >
                Full Page
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center border-2 border-line font-mono text-sm font-bold transition-colors hover:bg-accent-soft"
              aria-label="Close drawer"
            >
              X
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && <DrawerSkeleton />}
          {error && (
            <div className="p-6">
              <p className="font-mono text-sm text-red-600">{error}</p>
            </div>
          )}
          {!loading && !error && ticket && (
            <>
              {/* Ticket metadata */}
              <div className="border-b border-line px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-block px-3 py-1 font-mono text-xs font-bold uppercase ${statusColor[ticket.status] ?? "bg-zinc-200 text-black"}`}
                  >
                    {ticket.status}
                  </span>
                  <span
                    className={`inline-block px-3 py-1 font-mono text-xs font-bold uppercase ${priorityColor[ticket.priority] ?? "bg-zinc-200 text-black"}`}
                  >
                    {ticket.priority}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    #{ticket.externalId}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    via {ticket.source}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted">
                      Requester
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold">
                      {ticket.requester}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted">
                      Assignee
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold">
                      {ticket.assignee ?? "Unassigned"}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted">
                      Created
                    </p>
                    <p className="mt-0.5 font-mono text-sm">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted">
                      Updated
                    </p>
                    <p className="mt-0.5 font-mono text-sm">
                      {new Date(ticket.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                {ticket.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {ticket.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-line bg-accent-soft px-2 py-0.5 font-mono text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation thread */}
              <div className="px-6 py-4">
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                  Conversation ({messages.length})
                </h3>
                {messages.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`border-l-2 p-3 ${
                          msg.type === "note"
                            ? "border-amber-400 bg-amber-50/60"
                            : msg.type === "system"
                              ? "border-zinc-300 bg-zinc-50"
                              : "border-line bg-panel"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center bg-zinc-950 font-mono text-[10px] font-bold text-white">
                              {msg.type === "system"
                                ? "S"
                                : msg.author.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-mono text-xs font-bold">
                              {msg.type === "system" ? "System" : msg.author}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {msg.type === "note" && (
                              <span className="bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700">
                                Note
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-muted">
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
                          {msg.body}
                        </div>
                      </div>
                    ))}
                    <div ref={threadEndRef} />
                  </div>
                ) : (
                  <p className="mt-3 font-mono text-sm text-muted">
                    No messages yet.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Quick actions footer */}
        {!loading && !error && ticket && (
          <footer className="border-t-2 border-line bg-panel px-6 py-4">
            {/* Status quick-change */}
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase text-muted">
                Status:
              </span>
              {["open", "pending", "solved", "closed"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStatusChange(s)}
                  disabled={updatingStatus || ticket.status === s}
                  className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase transition-colors ${
                    ticket.status === s
                      ? `${statusColor[s]} cursor-default`
                      : "border border-line bg-panel text-muted hover:bg-accent-soft"
                  } disabled:opacity-50`}
                >
                  {s}
                </button>
              ))}
              {statusUpdate && (
                <span
                  className={`font-mono text-[10px] font-bold ${statusUpdate === "Updated" ? "text-emerald-600" : "text-red-600"}`}
                >
                  {statusUpdate}
                </span>
              )}
            </div>

            {/* Quick reply */}
            <div className="flex gap-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Quick reply..."
                rows={2}
                className="flex-1 resize-none border-2 border-line bg-panel p-2 font-mono text-sm focus:border-foreground focus:outline-none"
              />
              <button
                type="button"
                onClick={handleReply}
                disabled={replyState === "sending" || !replyBody.trim()}
                className="self-end border-2 border-line bg-foreground px-4 py-2 font-mono text-xs font-bold uppercase text-panel transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                {replyState === "sending"
                  ? "..."
                  : replyState === "success"
                    ? "Sent"
                    : replyState === "error"
                      ? "Failed"
                      : "Reply"}
              </button>
            </div>
          </footer>
        )}
      </aside>
    </>
  );
}

/** Loading skeleton for the drawer content */
function DrawerSkeleton() {
  return (
    <div className="animate-pulse px-6 py-4">
      {/* Metadata skeleton */}
      <div className="flex gap-2">
        <div className="h-6 w-16 bg-accent-soft" />
        <div className="h-6 w-16 bg-accent-soft" />
        <div className="h-6 w-24 bg-accent-soft" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <div className="h-3 w-16 bg-accent-soft" />
            <div className="mt-1 h-4 w-28 bg-accent-soft" />
          </div>
        ))}
      </div>

      {/* Thread skeleton */}
      <div className="mt-6">
        <div className="h-3 w-32 bg-accent-soft" />
        <div className="mt-3 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-l-2 border-accent-soft p-3">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 bg-accent-soft" />
                <div className="h-3 w-20 bg-accent-soft" />
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-3 w-full bg-accent-soft" />
                <div className="h-3 w-3/4 bg-accent-soft" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
