"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import EventMarker from "./EventMarker";
import { formatRelativeTime } from "@/lib/portal/format-time";

interface PortalTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

interface PortalMessage {
  id: string;
  body: string;
  authorType: string;
  isCustomer: boolean;
  createdAt: string;
}

interface TicketEvent {
  id: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType: string;
  actorLabel?: string | null;
  note?: string | null;
  createdAt: string;
}

type TimelineItem =
  | { kind: "message"; data: PortalMessage }
  | { kind: "event"; data: TicketEvent };

import { statusColor } from "@/lib/portal/ui";

export default function PortalTicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;

  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [replyBody, setReplyBody] = useState("");
  const [replyState, setReplyState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [replyMsg, setReplyMsg] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/tickets/${ticketId}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Failed to load ticket");
          return;
        }

        setTicket(data.ticket);
        setMessages(data.messages ?? []);
        setEvents(data.events ?? []);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [ticketId]);

  const onReply = async () => {
    if (!replyBody.trim()) return;
    setReplyState("sending");
    setReplyMsg("");

    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyBody }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Reply failed");
      }

      // Add to messages list
      setMessages((prev) => [
        ...prev,
        {
          id: data.message.id,
          body: data.message.body,
          authorType: "customer",
          isCustomer: true,
          createdAt: data.message.createdAt,
        },
      ]);

      setReplyBody("");
      setReplyMsg("Reply sent");
      setReplyState("success");
    } catch (err) {
      setReplyMsg(err instanceof Error ? err.message : "Failed");
      setReplyState("error");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading ticket...</p>
        </div>
      </main>
    );
  }

  if (error || !ticket) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold text-zinc-950">
            {error || "Ticket not found"}
          </p>
          <Link
            href="/portal/tickets"
            className="mt-4 inline-block border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Back to Tickets
          </Link>
        </div>
      </main>
    );
  }

  // Merge messages + events into a unified timeline
  const timeline: TimelineItem[] = [
    ...messages.map((m): TimelineItem => ({ kind: "message", data: m })),
    ...events.map((e): TimelineItem => ({ kind: "event", data: e })),
  ].sort(
    (a, b) =>
      new Date(a.data.createdAt).getTime() -
      new Date(b.data.createdAt).getTime()
  );

  const isClosed = ticket.status === "closed" || ticket.status === "solved";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-950">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/portal" className="hover:underline">
          Portal
        </Link>
        <span>/</span>
        <Link href="/portal/tickets" className="hover:underline">
          Tickets
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">
          {ticket.id.slice(0, 8)}
        </span>
      </nav>

      {/* Ticket header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{ticket.subject}</h1>
            <p className="mt-2 font-mono text-xs text-zinc-500">
              <span title={new Date(ticket.createdAt).toLocaleString()}>
                Opened {formatRelativeTime(ticket.createdAt)}
              </span>
              {" · "}
              <span title={new Date(ticket.updatedAt).toLocaleString()}>
                Updated {formatRelativeTime(ticket.updatedAt)}
              </span>
            </p>
          </div>
          <span
            className={`inline-block px-3 py-1 font-mono text-xs font-bold uppercase ${
              statusColor[ticket.status] ?? "bg-zinc-200 text-black"
            }`}
          >
            {ticket.status}
          </span>
        </div>

        {isClosed && (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            <Link
              href={`/portal/csat/${ticket.id}`}
              className="font-mono text-xs font-bold text-blue-600 hover:underline"
            >
              Rate your experience with this ticket
            </Link>
          </div>
        )}
      </header>

      {/* Timeline (messages + events merged) */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-6">
          <h2 className="text-lg font-bold">
            Conversation ({messages.length} message
            {messages.length !== 1 ? "s" : ""})
          </h2>
        </div>

        {timeline.length > 0 ? (
          <div className="divide-y divide-zinc-200">
            {(() => {
              let msgCounter = 0;
              return timeline.map((item) => {
                if (item.kind === "event") {
                  return (
                    <EventMarker key={`event-${item.data.id}`} event={item.data} />
                  );
                }

                msgCounter++;
                const msg = item.data;
                return (
                  <div
                    key={msg.id}
                    className={`p-6 ${msg.isCustomer ? "bg-blue-50/50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-8 w-8 items-center justify-center font-mono text-xs font-bold text-white ${
                            msg.isCustomer ? "bg-blue-500" : "bg-zinc-950"
                          }`}
                        >
                          {msg.isCustomer ? "Y" : "A"}
                        </div>
                        <div>
                          <p className="text-sm font-bold">
                            {msg.isCustomer ? "You" : "Support Agent"}
                          </p>
                          <p
                            className="font-mono text-xs text-zinc-500"
                            title={new Date(msg.createdAt).toLocaleString()}
                          >
                            {formatRelativeTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-zinc-400">
                        #{msgCounter}
                      </span>
                    </div>
                    <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                      {msg.body}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-zinc-500">
            No messages yet.
          </div>
        )}
      </section>

      {/* Reply form */}
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
          <div className="mt-3 flex items-center justify-end gap-3">
            {replyMsg && (
              <span
                className={`font-mono text-xs ${
                  replyState === "error"
                    ? "text-red-600"
                    : "text-emerald-600"
                }`}
              >
                {replyMsg}
              </span>
            )}
            <button
              type="button"
              onClick={onReply}
              disabled={replyState === "sending" || !replyBody.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {replyState === "sending" ? "Sending..." : "Send Reply"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
