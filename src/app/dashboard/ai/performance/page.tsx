import Link from "next/link";
import { getUsageReport, getUsageSummary } from "@/lib/ai/admin-controls";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Demo data — used when real snapshots are empty
// ---------------------------------------------------------------------------

function demoDailyRows() {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const iso = d.toISOString().slice(0, 10);
    const requests = 120 + Math.floor(Math.random() * 80);
    const resolved = Math.floor(requests * (0.55 + Math.random() * 0.2));
    const escalated = requests - resolved - Math.floor(Math.random() * 8);
    return {
      date: iso,
      requests,
      resolved,
      escalated: Math.max(0, escalated),
      avgConfidence: +(0.6 + Math.random() * 0.3).toFixed(2),
    };
  });
}

function demoTokenModels() {
  return [
    { model: "claude-sonnet-4-5", totalTokens: 1_847_200, promptTokens: 1_402_100, completionTokens: 445_100, costCents: 1293 },
    { model: "gpt-4o", totalTokens: 623_400, promptTokens: 481_200, completionTokens: 142_200, costCents: 374 },
    { model: "claude-haiku-3-5", totalTokens: 2_105_600, promptTokens: 1_780_000, completionTokens: 325_600, costCents: 263 },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AIPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Next.js 15 async searchParams — resolve synchronously for server component
  // We use the demo workspace "ws_demo" since no auth context exists yet
  const workspaceId = "ws_demo";

  // Try real data first
  const realSnapshots = getUsageReport(workspaceId);
  const hasReal = realSnapshots.length > 0;
  const summary = hasReal
    ? getUsageSummary(workspaceId)
    : {
        totalRequests: 2_184,
        autoResolved: 1_291,
        escalated: 612,
        errors: 47,
        totalTokens: 4_576_200,
        totalCostCents: 1_930,
        avgLatencyMs: 842,
        avgConfidence: 0.74,
        resolutionRate: 59,
      };

  const dailyRows = hasReal
    ? realSnapshots.map((s) => ({
        date: s.period.slice(0, 10),
        requests: s.totalRequests,
        resolved: s.autoResolved,
        escalated: s.escalated,
        avgConfidence: s.avgConfidence,
      }))
    : demoDailyRows();

  const tokenModels = hasReal
    ? [
        {
          model: "all models",
          totalTokens: summary.totalTokens,
          promptTokens: 0,
          completionTokens: 0,
          costCents: summary.totalCostCents,
        },
      ]
    : demoTokenModels();

  // Confidence distribution — derive from daily rows
  const confidenceBuckets = [
    { label: "0 - 25%", count: 0 },
    { label: "25 - 50%", count: 0 },
    { label: "50 - 75%", count: 0 },
    { label: "75 - 100%", count: 0 },
  ];
  for (const row of dailyRows) {
    const pct = row.avgConfidence * 100;
    if (pct < 25) confidenceBuckets[0].count += row.requests;
    else if (pct < 50) confidenceBuckets[1].count += row.requests;
    else if (pct < 75) confidenceBuckets[2].count += row.requests;
    else confidenceBuckets[3].count += row.requests;
  }
  const maxBucket = Math.max(...confidenceBuckets.map((b) => b.count), 1);

  const ranges = ["This Week", "This Month", "Last 90 Days"] as const;

  const statCards = [
    { label: "Total Requests", value: summary.totalRequests.toLocaleString() },
    { label: "Auto-Resolved %", value: `${summary.resolutionRate}%` },
    { label: "Avg Confidence", value: (summary.avgConfidence * 100).toFixed(0) + "%" },
    { label: "Avg Latency (ms)", value: summary.avgLatencyMs.toLocaleString() },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
              >
                Dashboard
              </Link>
              <span className="text-muted">/</span>
              <Link
                href="/ai"
                className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
              >
                AI
              </Link>
              <span className="text-muted">/</span>
              <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
                Performance
              </span>
            </div>
            <h1 className="mt-4 text-4xl font-bold">AI Performance</h1>
            {!hasReal && (
              <p className="mt-2 font-mono text-xs text-muted uppercase tracking-wider">
                Showing demo data
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {ranges.map((r) => (
              <span
                key={r}
                className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft cursor-pointer"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Stat Cards */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="border-2 border-line bg-panel p-5 text-center"
          >
            <p className="font-mono text-3xl font-bold">{s.value}</p>
            <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {/* Time-series Table */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Daily Breakdown</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted">
                  Date
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Requests
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Resolved
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Escalated
                </th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Avg Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.map((row) => (
                <tr
                  key={row.date}
                  className="border-b border-line/40 hover:bg-accent-soft"
                >
                  <td className="py-3 pr-6 font-bold">{row.date}</td>
                  <td className="py-3 pr-6 text-right">{row.requests}</td>
                  <td className="py-3 pr-6 text-right">{row.resolved}</td>
                  <td className="py-3 pr-6 text-right">{row.escalated}</td>
                  <td className="py-3 text-right">
                    {(row.avgConfidence * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Confidence Distribution */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Confidence Distribution</h2>
        <div className="mt-6 space-y-4">
          {confidenceBuckets.map((bucket) => {
            const pct = Math.round((bucket.count / maxBucket) * 100);
            return (
              <div key={bucket.label} className="flex items-center gap-4">
                <span className="w-24 shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-muted text-right">
                  {bucket.label}
                </span>
                <div className="flex-1 border-2 border-line bg-background">
                  <div
                    className="h-8 bg-foreground"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 font-mono text-sm font-bold text-right">
                  {bucket.count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Token / Cost Tracking */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Token &amp; Cost Tracking</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted">
                  Model
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Total Tokens
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Prompt Tokens
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Completion Tokens
                </th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Est. Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {tokenModels.map((m) => (
                <tr
                  key={m.model}
                  className="border-b border-line/40 hover:bg-accent-soft"
                >
                  <td className="py-3 pr-6 font-bold">{m.model}</td>
                  <td className="py-3 pr-6 text-right">
                    {m.totalTokens.toLocaleString()}
                  </td>
                  <td className="py-3 pr-6 text-right">
                    {m.promptTokens.toLocaleString()}
                  </td>
                  <td className="py-3 pr-6 text-right">
                    {m.completionTokens.toLocaleString()}
                  </td>
                  <td className="py-3 text-right font-bold">
                    ${(m.costCents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            {tokenModels.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-line">
                  <td className="pt-3 pr-6 font-bold uppercase text-xs tracking-wider">
                    Total
                  </td>
                  <td className="pt-3 pr-6 text-right font-bold">
                    {tokenModels
                      .reduce((s, m) => s + m.totalTokens, 0)
                      .toLocaleString()}
                  </td>
                  <td className="pt-3 pr-6 text-right font-bold">
                    {tokenModels
                      .reduce((s, m) => s + m.promptTokens, 0)
                      .toLocaleString()}
                  </td>
                  <td className="pt-3 pr-6 text-right font-bold">
                    {tokenModels
                      .reduce((s, m) => s + m.completionTokens, 0)
                      .toLocaleString()}
                  </td>
                  <td className="pt-3 text-right font-bold">
                    $
                    {(
                      tokenModels.reduce((s, m) => s + m.costCents, 0) / 100
                    ).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </main>
  );
}
