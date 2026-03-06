"use client";

import { useState, useEffect } from 'react';

interface DrillDownPanelProps {
  reportId: string;
  groupKey: string;
  groupValue: string;
  dateRange?: { from: string; to: string };
  onClose: () => void;
}

interface DrillDownTicket {
  id: string;
  subject: string;
  status: string;
  priority: string;
}

export default function DrillDownPanel({ reportId, groupKey, groupValue, dateRange, onClose }: DrillDownPanelProps) {
  const [tickets, setTickets] = useState<DrillDownTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/${reportId}/drill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupKey, groupValue, dateRange }),
        });
        if (res.ok) {
          const data = await res.json();
          setTotal(data.drillDown.count);
          // Load ticket details for the IDs
          const ticketIds = data.drillDown.ticketIds.slice(0, 20);
          const ticketRes = await fetch(`/api/tickets?ids=${ticketIds.join(',')}`);
          if (ticketRes.ok) {
            const ticketData = await ticketRes.json();
            setTickets(ticketData.tickets ?? []);
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, [reportId, groupKey, groupValue, dateRange]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 border-l-2 border-zinc-950 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b-2 border-zinc-950 p-4">
        <div>
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">Drill Down</p>
          <p className="mt-1 text-sm font-bold">
            {groupKey}: {groupValue}
          </p>
        </div>
        <button
          onClick={onClose}
          className="border-2 border-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
        >
          Close
        </button>
      </div>
      <div className="p-4">
        {loading ? (
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        ) : (
          <>
            <p className="font-mono text-xs text-zinc-500">{total} tickets match</p>
            <div className="mt-4 space-y-2">
              {tickets.map(t => (
                <a
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="block border border-zinc-200 p-3 transition-colors hover:bg-zinc-50"
                >
                  <p className="text-sm font-bold truncate">{t.subject}</p>
                  <div className="mt-1 flex gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase bg-zinc-200 px-1.5 py-0.5">
                      {t.status}
                    </span>
                    <span className="font-mono text-[10px] font-bold uppercase bg-zinc-200 px-1.5 py-0.5">
                      {t.priority}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
