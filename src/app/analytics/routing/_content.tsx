"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface RoutingAnalytics {
  avgAssignmentTimeMs: number;
  totalRoutedToday: number;
  overflowCount: number;
  utilization: number;
  agentAvailability: { online: number; away: number; offline: number };
  assignmentsByAgent: Record<string, number>;
  strategyDistribution: Record<string, number>;
  queueCount: number;
}

interface LogEntry {
  id: string;
  ticketId: string;
  assignedUserId?: string;
  queueId?: string;
  strategy: string;
  matchedSkills: string[];
  durationMs: number;
  createdAt: string;
}

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: "Round Robin",
  load_balanced: "Load Balanced",
  skill_match: "Skill Match",
  priority_weighted: "Priority Weighted",
};

export default function RoutingAnalyticsContent() {
  const [data, setData] = useState<RoutingAnalytics | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, logRes] = await Promise.all([
        fetch("/api/routing/analytics"),
        fetch("/api/routing/log?limit=50"),
      ]);
      setData(await analyticsRes.json());
      setLog(await logRes.json());
    } catch {
      // fail gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading routing analytics...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/analytics" className="hover:underline">Analytics</Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Routing</span>
        </nav>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Routing Analytics
        </p>
        <h1 className="mt-2 text-3xl font-bold">Routing Performance</h1>
      </header>

      {data && (
        <>
          {/* STAT CARDS */}
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Avg Assignment Time" value={`${data.avgAssignmentTimeMs}ms`} />
            <StatCard label="Routed Today" value={String(data.totalRoutedToday)} />
            <StatCard
              label="Overflow Count"
              value={String(data.overflowCount)}
              accent={data.overflowCount > 0 ? "text-amber-600" : undefined}
            />
            <StatCard
              label="Agent Utilization"
              value={`${data.utilization}%`}
              accent={data.utilization >= 80 ? "text-emerald-600" : data.utilization >= 50 ? "text-amber-600" : "text-red-600"}
            />
          </section>

          {/* AGENT AVAILABILITY */}
          <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Agent Availability</h2>
            <div className="mt-4 flex gap-8">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
                <span className="font-mono text-sm">Online: {data.agentAvailability.online}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-amber-400" />
                <span className="font-mono text-sm">Away: {data.agentAvailability.away}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-zinc-400" />
                <span className="font-mono text-sm">Offline: {data.agentAvailability.offline}</span>
              </div>
            </div>
          </section>

          {/* ASSIGNMENTS BY AGENT */}
          {Object.keys(data.assignmentsByAgent).length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Assignments by Agent</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(data.assignmentsByAgent)
                  .sort(([, a], [, b]) => b - a)
                  .map(([agentId, count]) => {
                    const max = Math.max(...Object.values(data.assignmentsByAgent), 1);
                    return (
                      <div key={agentId} className="flex items-center justify-between">
                        <span className="font-mono text-sm">{agentId.slice(0, 12)}</span>
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-32 bg-zinc-200">
                            <div className="h-full bg-zinc-950" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right font-mono text-sm font-bold">{count}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {/* STRATEGY DISTRIBUTION */}
          {Object.keys(data.strategyDistribution).length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Strategy Distribution</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(data.strategyDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([strategy, count]) => {
                    const total = Object.values(data.strategyDistribution).reduce((a, b) => a + b, 0);
                    return (
                      <div key={strategy} className="flex items-center justify-between">
                        <span className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-bold">
                          {STRATEGY_LABELS[strategy] ?? strategy}
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-32 bg-zinc-200">
                            <div className="h-full bg-zinc-950" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
                          </div>
                          <span className="w-8 text-right font-mono text-sm font-bold">{count}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}
        </>
      )}

      {/* ROUTING LOG */}
      {log.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 p-6">
            <h2 className="text-lg font-bold">Routing Log</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Time</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Ticket</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Strategy</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Skills</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Duration</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(-20).reverse().map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {entry.createdAt.slice(0, 19)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {entry.ticketId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {entry.assignedUserId?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold">
                        {STRATEGY_LABELS[entry.strategy] ?? entry.strategy}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {entry.matchedSkills?.join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {entry.durationMs}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* EMPTY STATE */}
      {data && data.totalRoutedToday === 0 && log.length === 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No routing data yet</p>
          <p className="mt-2 text-sm text-zinc-600">
            Route a ticket: <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">cliaas routing route &lt;ticketId&gt;</code>
          </p>
        </section>
      )}
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-zinc-950"}`}>{value}</p>
    </div>
  );
}
