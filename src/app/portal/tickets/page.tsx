"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/portal/format-time";

interface PortalTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  slaDueAt?: string;
  slaBreachedAt?: string;
  requesterEmail?: string;
}

import { statusColor, priorityDot } from "@/lib/portal/ui";

export default function PortalTicketsPage() {
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"my" | "org">("my");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Fetch org info on mount
  useEffect(() => {
    async function checkOrg() {
      try {
        const res = await fetch("/api/portal/me");
        if (res.ok) {
          const data = await res.json();
          if (data.orgName) setOrgName(data.orgName);
        }
      } catch {
        // No org info available
      }
    }
    checkOrg();
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (scope === "org") params.set("scope", "org");

      const res = await fetch(`/api/portal/tickets?${params}`);
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setError("Please sign in to view your tickets.");
        } else {
          setError(data.error ?? "Failed to load tickets");
        }
        return;
      }

      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [scope, page]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Reset page when scope changes
  useEffect(() => {
    setPage(1);
  }, [scope]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold text-zinc-950">Access Required</p>
          <p className="mt-2 text-sm text-zinc-600">{error}</p>
          <Link
            href="/portal"
            className="mt-4 inline-block border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Sign In
          </Link>
        </div>
      </main>
    );
  }

  const hasMore = page * limit < total;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              {scope === "org" ? "Organization Tickets" : "My Tickets"}
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {total} ticket{total !== 1 ? "s" : ""}
            </h1>
          </div>
          <Link
            href="/portal/tickets/new"
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Ticket
          </Link>
        </div>

        {/* Org tab bar */}
        {orgName && (
          <div className="mt-6 flex gap-0">
            <button
              onClick={() => setScope("my")}
              className={`px-4 py-2 font-mono text-xs font-bold uppercase ${
                scope === "my"
                  ? "bg-zinc-950 text-white"
                  : "border-2 border-zinc-950 text-zinc-950"
              }`}
            >
              My Tickets
            </button>
            <button
              onClick={() => setScope("org")}
              className={`px-4 py-2 font-mono text-xs font-bold uppercase ${
                scope === "org"
                  ? "bg-zinc-950 text-white"
                  : "border-2 border-zinc-950 text-zinc-950"
              }`}
            >
              {orgName}
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading tickets...</p>
        </section>
      ) : tickets.length > 0 ? (
        <>
          <section className="mt-8 border-2 border-zinc-950 bg-white">
            <div className="divide-y divide-zinc-200">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/portal/tickets/${t.id}`}
                  className="flex items-center justify-between p-6 transition-colors hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {/* Priority dot */}
                      <div
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          priorityDot[t.priority] ?? "bg-zinc-200"
                        }`}
                        title={t.priority}
                      />
                      <p className="truncate text-sm font-bold">{t.subject}</p>
                    </div>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      <span title={new Date(t.createdAt).toLocaleString()}>
                        Opened {formatRelativeTime(t.createdAt)}
                      </span>
                      {" · "}
                      <span title={new Date(t.updatedAt).toLocaleString()}>
                        Updated {formatRelativeTime(t.updatedAt)}
                      </span>
                    </p>
                    {/* Org scope: show requester email */}
                    {scope === "org" && t.requesterEmail && (
                      <p className="mt-0.5 font-mono text-xs text-zinc-400">
                        {t.requesterEmail}
                      </p>
                    )}
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    {/* SLA badges */}
                    {t.slaBreachedAt && (
                      <span className="px-1.5 py-0.5 font-mono text-xs font-bold uppercase bg-red-500 text-white">
                        SLA
                      </span>
                    )}
                    {!t.slaBreachedAt && t.slaDueAt && (
                      <span className="px-1.5 py-0.5 font-mono text-xs font-bold uppercase bg-amber-400 text-black">
                        DUE
                      </span>
                    )}
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        statusColor[t.status] ?? "bg-zinc-200 text-black"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Pagination */}
          {hasMore && (
            <div className="mt-6 text-center">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="border-2 border-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-950 hover:text-white"
              >
                Load More
              </button>
            </div>
          )}
        </>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No tickets found</p>
          <p className="mt-2 text-sm text-zinc-600">
            {scope === "org"
              ? "No tickets found for your organization."
              : "You have no open tickets."}{" "}
            <Link
              href="/portal/tickets/new"
              className="font-bold underline hover:no-underline"
            >
              Submit a new request
            </Link>{" "}
            to get help.
          </p>
        </section>
      )}
    </main>
  );
}
