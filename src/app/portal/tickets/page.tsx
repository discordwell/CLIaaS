"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PortalTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

const statusColor: Record<string, string> = {
  open: "bg-blue-500 text-white",
  pending: "bg-amber-400 text-black",
  solved: "bg-emerald-500 text-white",
  closed: "bg-zinc-500 text-white",
};

export default function PortalTicketsPage() {
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/tickets");
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
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading tickets...</p>
        </div>
      </main>
    );
  }

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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              My Tickets
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
            </h1>
          </div>
          <Link
            href="/portal/tickets/new"
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Ticket
          </Link>
        </div>
      </header>

      {tickets.length > 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="divide-y divide-zinc-200">
            {tickets.map((t) => (
              <Link
                key={t.id}
                href={`/portal/tickets/${t.id}`}
                className="flex items-center justify-between p-6 transition-colors hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{t.subject}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    Opened {new Date(t.createdAt).toLocaleDateString()} · Updated{" "}
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
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
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No tickets found</p>
          <p className="mt-2 text-sm text-zinc-600">
            You have no open tickets.{" "}
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
