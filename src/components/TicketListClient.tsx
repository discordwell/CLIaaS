"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TicketMergeBar from "./TicketMergeBar";

interface TicketRow {
  id: string;
  externalId: string;
  subject: string;
  source: string;
  status: string;
  priority: string;
  assignee?: string;
  requester: string;
  createdAt: string;
  mergedIntoTicketId?: string;
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

export default function TicketListClient({ tickets }: { tickets: TicketRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === tickets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tickets.map((t) => t.id)));
    }
  }, [selected.size, tickets]);

  const handleMergeComplete = useCallback(() => {
    setSelected(new Set());
    router.refresh();
  }, [router]);

  return (
    <>
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === tickets.length && tickets.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-zinc-950"
                  />
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  ID
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Subject
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Source
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Status
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Priority
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Assignee
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Requester
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${
                    selected.has(t.id) ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      className="h-4 w-4 accent-zinc-950"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/tickets/${t.id}`}
                      className="font-mono text-xs font-bold text-blue-600 hover:underline"
                    >
                      {t.externalId}
                    </Link>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <Link
                      href={`/tickets/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.subject}
                    </Link>
                    {t.mergedIntoTicketId && (
                      <span className="ml-2 inline-block bg-zinc-200 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-600">
                        merged
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-zinc-200 px-2 py-0.5 font-mono text-xs font-bold uppercase text-zinc-700">
                      {t.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        statusColor[t.status] ?? "bg-zinc-200 text-black"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        priorityColor[t.priority] ?? "bg-zinc-200 text-black"
                      }`}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{t.assignee ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {t.requester}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected.size >= 2 && (
        <TicketMergeBar
          selectedIds={Array.from(selected)}
          onMergeComplete={handleMergeComplete}
        />
      )}
    </>
  );
}
