"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import TicketInboxDetail from "./TicketInboxDetail";

export interface TicketRow {
  id: string;
  externalId: string;
  subject: string;
  source: string;
  status: string;
  priority: string;
  assignee?: string;
  requester: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  mergedIntoTicketId?: string;
}

interface TicketInboxProps {
  tickets: TicketRow[];
  stats: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
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

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo`;
}

export default function TicketInbox({ tickets, stats }: TicketInboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTicketId = searchParams.get("id");

  const [statusFilter, setStatusFilter] = useState<string | null>(
    searchParams.get("status")
  );
  const [priorityFilter, setPriorityFilter] = useState<string | null>(
    searchParams.get("priority")
  );

  const filteredTickets = useMemo(() => {
    let result = tickets;
    if (statusFilter) {
      result = result.filter((t) => t.status === statusFilter);
    }
    if (priorityFilter) {
      result = result.filter((t) => t.priority === priorityFilter);
    }
    return result;
  }, [tickets, statusFilter, priorityFilter]);

  const selectTicket = useCallback(
    (ticketId: string) => {
      // On mobile, navigate to the full page
      if (window.innerWidth < 768) {
        router.push(`/tickets/${ticketId}`);
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("id", ticketId);
      router.replace(`/tickets?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const updateFilter = useCallback(
    (key: "status" | "priority", value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key === "status") setStatusFilter(value);
      if (key === "priority") setPriorityFilter(value);
      router.replace(`/tickets?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId);

  return (
    <div className="flex h-[calc(100vh-49px)] font-mono">
      {/* LEFT PANE — Ticket List */}
      <div className="flex w-full flex-col border-r-2 border-line md:w-[38%]">
        {/* Header */}
        <div className="flex-shrink-0 border-b-2 border-line bg-panel px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Tickets ({filteredTickets.length})
            </h1>
            <Link
              href="/dashboard"
              className="text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
            >
              Dashboard
            </Link>
          </div>

          {/* Filter pills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(["open", "pending", "solved", "closed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  updateFilter("status", statusFilter === s ? null : s)
                }
                className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  statusFilter === s
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-panel text-muted hover:border-zinc-950"
                }`}
              >
                {s} ({stats.byStatus[s] ?? 0})
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(["urgent", "high", "normal", "low"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  updateFilter("priority", priorityFilter === p ? null : p)
                }
                className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  priorityFilter === p
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-panel text-muted hover:border-zinc-950"
                }`}
              >
                {p} ({stats.byPriority[p] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {/* Ticket rows */}
        <div className="flex-1 overflow-y-auto">
          {filteredTickets.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">
              No tickets match the current filters.
            </div>
          ) : (
            filteredTickets.map((ticket) => {
              const isSelected = ticket.id === selectedTicketId;
              return (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => selectTicket(ticket.id)}
                  className={`block w-full border-b border-zinc-200 px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "bg-zinc-100 border-l-2 border-l-zinc-950"
                      : "bg-panel hover:bg-zinc-50"
                  }`}
                  data-testid={`ticket-row-${ticket.id}`}
                >
                  {/* Row 1: Subject + time */}
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm leading-snug ${
                        isSelected ? "font-bold" : "font-medium"
                      } line-clamp-1 text-foreground`}
                    >
                      {ticket.subject}
                    </p>
                    <span className="flex-shrink-0 text-[10px] text-muted">
                      {timeAgo(ticket.updatedAt)}
                    </span>
                  </div>

                  {/* Row 2: Pills + assignee */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none ${
                        statusColor[ticket.status] ?? "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {ticket.status}
                    </span>
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none ${
                        priorityColor[ticket.priority] ??
                        "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {ticket.priority}
                    </span>
                    {ticket.mergedIntoTicketId && (
                      <span className="inline-block bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-zinc-600">
                        merged
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted">
                      {ticket.assignee ?? "unassigned"}
                    </span>
                  </div>

                  {/* Row 3: Requester + ID */}
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-muted">
                      {ticket.requester}
                    </span>
                    <span className="text-[10px] text-muted">
                      #{ticket.externalId}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANE — Ticket Detail */}
      <div className="hidden flex-1 md:flex md:flex-col">
        {selectedTicket ? (
          <TicketInboxDetail
            ticketId={selectedTicket.id}
            ticket={selectedTicket}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center bg-panel">
            <div className="text-center">
              <p className="text-lg font-bold text-muted">
                Select a ticket to view
              </p>
              <p className="mt-2 text-xs text-muted">
                Choose a ticket from the list on the left
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
