"use client";

import { useEffect, useState, useCallback } from "react";

interface AnalyticsData {
  ticketsCreated: { date: string; count: number }[];
  ticketsByChannel: Record<string, number>;
  ticketsBySource: Record<string, number>;
  avgResponseTimeHours: number;
  avgResolutionTimeHours: number;
  firstResponseSLA: { met: number; breached: number };
  resolutionSLA: { met: number; breached: number };
  agentPerformance: Array<{
    name: string;
    ticketsHandled: number;
    avgResolutionHours: number;
    csatAvg: number;
  }>;
  csatOverall: number;
  csatTrend: { date: string; score: number }[];
  topTags: Array<{ tag: string; count: number }>;
  priorityDistribution: Record<string, number>;
  periodComparison: {
    current: { tickets: number; avgResponseHours: number; resolved: number };
    previous: { tickets: number; avgResponseHours: number; resolved: number };
  };
  totalTickets: number;
  dateRange: { from: string; to: string };
}

const priorityColor: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-orange-400 text-black",
  normal: "bg-yellow-300 text-black",
  low: "bg-zinc-300 text-black",
};

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.floor(hours / 24);
  const remainHours = Math.round(hours % 24);
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export default function AnalyticsPageContent() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const url = `/api/analytics${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleExport(format: "csv" | "json") {
    const params = new URLSearchParams();
    params.set("format", format);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    window.open(`/api/analytics/export?${params}`, "_blank");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Analytics
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              Support Analytics
            </h1>
          </div>
        </div>

        {/* Date range + export */}
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
          <button
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="border-2 border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:border-zinc-950"
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport("csv")}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Export CSV
            </button>
            <button
              onClick={() => handleExport("json")}
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Export JSON
            </button>
          </div>
        </div>
      </header>

      {loading && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading analytics...</p>
        </section>
      )}

      {error && (
        <section className="mt-8 border-2 border-red-500 bg-red-50 p-8">
          <p className="font-mono text-sm font-bold text-red-700">{error}</p>
        </section>
      )}

      {data && !loading && (
        <>
          {/* STAT CARDS */}
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Tickets" value={String(data.totalTickets)} />
            <StatCard
              label="Avg Response"
              value={formatHours(data.avgResponseTimeHours)}
            />
            <StatCard
              label="Avg Resolution"
              value={formatHours(data.avgResolutionTimeHours)}
            />
            <StatCard
              label="CSAT Score"
              value={data.csatOverall > 0 ? `${data.csatOverall}/5` : "N/A"}
              accent={data.csatOverall >= 4 ? "text-emerald-600" : data.csatOverall >= 3 ? "text-amber-600" : "text-red-600"}
            />
          </section>

          {/* PERIOD COMPARISON */}
          <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">This Week vs Last Week</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <ComparisonCard
                label="Tickets Created"
                current={data.periodComparison.current.tickets}
                previous={data.periodComparison.previous.tickets}
              />
              <ComparisonCard
                label="Avg Response (hrs)"
                current={data.periodComparison.current.avgResponseHours}
                previous={data.periodComparison.previous.avgResponseHours}
                invertColor
              />
              <ComparisonCard
                label="Resolved"
                current={data.periodComparison.current.resolved}
                previous={data.periodComparison.previous.resolved}
              />
            </div>
          </section>

          {/* VOLUME CHART */}
          {data.ticketsCreated.length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Ticket Volume</h2>
              <p className="mt-1 font-mono text-xs text-zinc-500">
                {data.dateRange.from} to {data.dateRange.to}
              </p>
              <div className="mt-4">
                <BarChart data={data.ticketsCreated} />
              </div>
            </section>
          )}

          {/* SLA COMPLIANCE + SOURCE */}
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            {/* SLA Compliance */}
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">SLA Compliance</h2>
              <div className="mt-4 space-y-4">
                <SLABar
                  label="First Response"
                  met={data.firstResponseSLA.met}
                  breached={data.firstResponseSLA.breached}
                />
                <SLABar
                  label="Resolution"
                  met={data.resolutionSLA.met}
                  breached={data.resolutionSLA.breached}
                />
              </div>
            </section>

            {/* By Source */}
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">By Source</h2>
              <div className="mt-4 space-y-3">
                {Object.entries(data.ticketsBySource)
                  .sort(([, a], [, b]) => b - a)
                  .map(([source, count]) => (
                    <div key={source} className="flex items-center justify-between">
                      <span className="inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase bg-zinc-200 text-zinc-700">
                        {source}
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 bg-zinc-200">
                          <div
                            className="h-full bg-zinc-950"
                            style={{
                              width: `${data.totalTickets > 0 ? (count / data.totalTickets) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-sm font-bold">{count}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          {/* PRIORITY DISTRIBUTION */}
          <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Priority Distribution</h2>
            <div className="mt-4 space-y-3">
              {["urgent", "high", "normal", "low"]
                .filter((p) => data.priorityDistribution[p])
                .map((priority) => {
                  const count = data.priorityDistribution[priority] ?? 0;
                  return (
                    <div key={priority} className="flex items-center justify-between">
                      <span
                        className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${priorityColor[priority] ?? "bg-zinc-200"}`}
                      >
                        {priority}
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-32 bg-zinc-200">
                          <div
                            className="h-full bg-zinc-950"
                            style={{
                              width: `${data.totalTickets > 0 ? (count / data.totalTickets) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-sm font-bold">
                          {count}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">
                          ({data.totalTickets > 0 ? Math.round((count / data.totalTickets) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          {/* AGENT PERFORMANCE */}
          {data.agentPerformance.length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-950 p-6">
                <h2 className="text-lg font-bold">Agent Performance</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Tickets</th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Avg Resolution</th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">CSAT</th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentPerformance.map((agent) => {
                      const maxTickets = Math.max(...data.agentPerformance.map((a) => a.ticketsHandled), 1);
                      return (
                        <tr key={agent.name} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                          <td className="px-4 py-3 font-medium">{agent.name}</td>
                          <td className="px-4 py-3 font-mono text-sm font-bold">{agent.ticketsHandled}</td>
                          <td className="px-4 py-3 font-mono text-sm">
                            {agent.avgResolutionHours > 0 ? formatHours(agent.avgResolutionHours) : "---"}
                          </td>
                          <td className="px-4 py-3">
                            {agent.csatAvg > 0 ? (
                              <span className={`font-mono text-sm font-bold ${
                                agent.csatAvg >= 4 ? "text-emerald-600" : agent.csatAvg >= 3 ? "text-amber-600" : "text-red-600"
                              }`}>
                                {agent.csatAvg}/5
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-zinc-400">N/A</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="h-2 w-24 bg-zinc-200">
                              <div
                                className="h-full bg-zinc-950"
                                style={{ width: `${(agent.ticketsHandled / maxTickets) * 100}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* CSAT TREND */}
          {data.csatTrend.length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">CSAT Trend</h2>
              <div className="mt-4 space-y-2">
                {data.csatTrend.map((entry) => (
                  <div key={entry.date} className="flex items-center gap-4">
                    <span className="w-24 font-mono text-xs text-zinc-500">{entry.date}</span>
                    <div className="flex-1">
                      <div className="h-4 bg-zinc-200">
                        <div
                          className={`h-full ${entry.score >= 4 ? "bg-emerald-500" : entry.score >= 3 ? "bg-amber-400" : "bg-red-500"}`}
                          style={{ width: `${(entry.score / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-12 text-right font-mono text-sm font-bold">{entry.score}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TOP TAGS */}
          {data.topTags.length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Top Tags</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.topTags.map(({ tag, count }) => (
                  <span
                    key={tag}
                    className="border border-zinc-300 bg-zinc-100 px-3 py-1 font-mono text-xs font-bold"
                  >
                    {tag} ({count})
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* NO DATA */}
          {data.totalTickets === 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No ticket data found</p>
              <p className="mt-2 text-sm text-zinc-600">
                Generate demo data: <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">cliaas demo generate</code>
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ---- Sub-components ----

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-zinc-950"}`}>{value}</p>
    </div>
  );
}

function ComparisonCard({
  label,
  current,
  previous,
  invertColor,
}: {
  label: string;
  current: number;
  previous: number;
  invertColor?: boolean;
}) {
  const change = pctChange(current, previous);
  const isPositive = change.startsWith("+") && change !== "+0%";
  const isNegative = change.startsWith("-");
  // For response time, lower is better
  const colorClass = invertColor
    ? isNegative ? "text-emerald-600" : isPositive ? "text-red-600" : "text-zinc-500"
    : isPositive ? "text-emerald-600" : isNegative ? "text-red-600" : "text-zinc-500";

  return (
    <div className="border border-zinc-200 p-4">
      <p className="font-mono text-xs font-bold uppercase text-zinc-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-2xl font-bold">{typeof current === "number" && current % 1 !== 0 ? current.toFixed(1) : current}</span>
        <span className={`font-mono text-xs font-bold ${colorClass}`}>{change}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-zinc-400">prev: {typeof previous === "number" && previous % 1 !== 0 ? previous.toFixed(1) : previous}</p>
    </div>
  );
}

function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  // Show last 30 days max
  const visible = data.slice(-30);

  return (
    <div className="flex items-end gap-1" style={{ height: "160px" }}>
      {visible.map((entry) => {
        const heightPct = (entry.count / maxCount) * 100;
        return (
          <div
            key={entry.date}
            className="group relative flex-1 min-w-0"
            style={{ height: "100%" }}
          >
            <div className="absolute bottom-0 left-0 right-0 bg-zinc-950 transition-all hover:bg-zinc-700"
              style={{ height: `${heightPct}%`, minHeight: entry.count > 0 ? "2px" : "0px" }}
            />
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-950 px-2 py-1 font-mono text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              {entry.date}: {entry.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SLABar({ label, met, breached }: { label: string; met: number; breached: number }) {
  const total = met + breached;
  const metPct = total > 0 ? Math.round((met / total) * 100) : 0;
  const breachedPct = total > 0 ? 100 - metPct : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold uppercase">{label}</span>
        <span className="font-mono text-xs text-zinc-500">
          {metPct}% met ({met}/{total})
        </span>
      </div>
      <div className="mt-1 flex h-3 w-full overflow-hidden bg-zinc-200">
        {metPct > 0 && (
          <div className="bg-emerald-500" style={{ width: `${metPct}%` }} />
        )}
        {breachedPct > 0 && (
          <div className="bg-red-500" style={{ width: `${breachedPct}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-zinc-400">
        <span>Met: {met}</span>
        <span>Breached: {breached}</span>
      </div>
    </div>
  );
}
