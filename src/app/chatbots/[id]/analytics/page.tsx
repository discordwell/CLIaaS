"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface AnalyticsRow {
  nodeId: string;
  date: string;
  entries: number;
  exits: number;
  dropOffs: number;
}

interface Summary {
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  handoffSessions: number;
  avgNodesPerSession: number;
  topDropOffNodes: Array<{ nodeId: string; dropOffs: number }>;
}

export default function ChatbotAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [botName, setBotName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, detailRes, botRes] = await Promise.all([
        fetch(`/api/chatbots/${id}/analytics/summary?days=${days}`),
        fetch(`/api/chatbots/${id}/analytics?days=${days}`),
        fetch(`/api/chatbots/${id}`),
      ]);

      if (sumRes.ok) setSummary(await sumRes.json());
      if (detailRes.ok) {
        const data = await detailRes.json();
        setRows(data.rows ?? []);
      }
      if (botRes.ok) {
        const bot = await botRes.json();
        setBotName(bot.name ?? id);
      }
    } catch {
      // network error
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => {
    load();
  }, [load]);

  // Aggregate rows by node for the table
  const nodeAgg = new Map<string, { entries: number; exits: number; dropOffs: number }>();
  for (const r of rows) {
    const existing = nodeAgg.get(r.nodeId) ?? { entries: 0, exits: 0, dropOffs: 0 };
    existing.entries += r.entries;
    existing.exits += r.exits;
    existing.dropOffs += r.dropOffs;
    nodeAgg.set(r.nodeId, existing);
  }

  const sortedNodes = Array.from(nodeAgg.entries()).sort((a, b) => b[1].entries - a[1].entries);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Chatbot Analytics
            </p>
            <h1 className="mt-2 text-3xl font-bold">{botName || "..."}</h1>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border-2 border-zinc-950 bg-white px-3 py-2 font-mono text-xs"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Link
              href={`/chatbots/builder/${id}`}
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Builder
            </Link>
            <Link
              href="/chatbots"
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              All Bots
            </Link>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-12 text-center">
          <p className="font-mono text-xs text-zinc-400">Loading analytics...</p>
        </div>
      ) : !summary ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-12 text-center">
          <p className="font-mono text-xs text-zinc-400">No analytics data yet. Run some test sessions first.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mt-8 grid grid-cols-2 gap-0 lg:grid-cols-4">
            {[
              { label: "Total Sessions", value: summary.totalSessions },
              { label: "Completed", value: summary.completedSessions },
              { label: "Abandoned", value: summary.abandonedSessions },
              { label: "Avg Nodes/Session", value: summary.avgNodesPerSession },
            ].map((card, i) => (
              <div key={card.label} className={`border-2 border-zinc-950 bg-white p-6 ${i > 0 ? "border-l-0" : ""}`}>
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {card.label}
                </p>
                <p className="mt-2 text-3xl font-bold">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Drop-off nodes */}
          {summary.topDropOffNodes.length > 0 && (
            <div className="mt-8 border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-200 bg-zinc-50 px-6 py-3">
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Top Drop-Off Points
                </span>
              </div>
              <div className="divide-y divide-zinc-100">
                {summary.topDropOffNodes.map((n) => {
                  const maxDropOffs = summary.topDropOffNodes[0]?.dropOffs ?? 1;
                  const pct = Math.round((n.dropOffs / maxDropOffs) * 100);
                  return (
                    <div key={n.nodeId} className="flex items-center gap-4 px-6 py-3">
                      <span className="w-20 font-mono text-xs text-zinc-500">{n.nodeId.slice(0, 8)}</span>
                      <div className="flex-1">
                        <div className="h-4 w-full bg-zinc-100">
                          <div className="h-full bg-red-400" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="w-16 text-right font-mono text-xs font-bold">{n.dropOffs}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-node table */}
          {sortedNodes.length > 0 && (
            <div className="mt-8 border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-200 bg-zinc-50 px-6 py-3">
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Per-Node Breakdown
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-200 text-left font-mono text-[10px] font-bold uppercase text-zinc-400">
                    <th className="px-6 py-2">Node</th>
                    <th className="px-6 py-2 text-right">Entries</th>
                    <th className="px-6 py-2 text-right">Exits</th>
                    <th className="px-6 py-2 text-right">Drop-offs</th>
                    <th className="px-6 py-2 text-right">Drop %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sortedNodes.map(([nodeId, agg]) => (
                    <tr key={nodeId}>
                      <td className="px-6 py-2 font-mono text-xs">{nodeId.slice(0, 8)}</td>
                      <td className="px-6 py-2 text-right font-mono text-xs">{agg.entries}</td>
                      <td className="px-6 py-2 text-right font-mono text-xs">{agg.exits}</td>
                      <td className="px-6 py-2 text-right font-mono text-xs">{agg.dropOffs}</td>
                      <td className="px-6 py-2 text-right font-mono text-xs">
                        {agg.entries > 0 ? `${Math.round((agg.dropOffs / agg.entries) * 100)}%` : "0%"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
