import Link from "next/link";
import { getQAOverview } from "@/lib/ai/qa";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Demo data — used when no real QA reports exist
// ---------------------------------------------------------------------------

function demoFlaggedConversations() {
  const agents = ["Sarah K.", "Marcus T.", "Priya R.", "James W.", "Aisha M."];
  const reasons = [
    "Low tone score — dismissive language detected",
    "Incomplete response — customer question unanswered",
    "Policy violation — shared internal URL",
    "Accuracy concern — contradicts KB article #412",
    "Brand voice — excessive casual slang",
    "Very short response — only 8 words",
    "Repeated previous reply verbatim",
    "Hedging language reduces customer confidence",
  ];
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setHours(d.getHours() - i * 6 - Math.floor(Math.random() * 4));
    return {
      ticketId: `TK-${4200 + i}`,
      agent: agents[i % agents.length],
      score: Math.floor(Math.random() * 35 + 10),
      reason: reasons[i % reasons.length],
      date: d.toISOString().slice(0, 10),
    };
  });
}

function demoAgentBreakdown() {
  return [
    { agent: "Sarah K.", avgScore: 82, totalScored: 47, flagged: 2, trend: "up" as const },
    { agent: "Marcus T.", avgScore: 74, totalScored: 53, flagged: 5, trend: "down" as const },
    { agent: "Priya R.", avgScore: 91, totalScored: 38, flagged: 0, trend: "up" as const },
    { agent: "James W.", avgScore: 68, totalScored: 61, flagged: 8, trend: "down" as const },
    { agent: "Aisha M.", avgScore: 86, totalScored: 44, flagged: 1, trend: "flat" as const },
    { agent: "Carlos D.", avgScore: 77, totalScored: 35, flagged: 3, trend: "up" as const },
    { agent: "Lena F.", avgScore: 89, totalScored: 29, flagged: 1, trend: "flat" as const },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AutoQAResultsPage() {
  const overview = getQAOverview();
  const hasReal = overview.totalScored > 0;

  // Stat values
  const avgScore = hasReal
    ? Math.round(overview.avgOverall * 20) // convert 1-5 scale to 0-100
    : 78;
  const totalScored = hasReal ? overview.totalScored : 307;
  const flaggedCount = hasReal ? overview.flagCount : 20;

  // Score distribution (0-100 scale)
  const scoreDistribution = hasReal
    ? (() => {
        const buckets = [0, 0, 0, 0, 0]; // 0-20, 20-40, 40-60, 60-80, 80-100
        for (const r of overview.recentReports) {
          const pct = r.scores.overall * 20;
          if (pct < 20) buckets[0]++;
          else if (pct < 40) buckets[1]++;
          else if (pct < 60) buckets[2]++;
          else if (pct < 80) buckets[3]++;
          else buckets[4]++;
        }
        return buckets;
      })()
    : [8, 19, 42, 134, 104];

  const scoreBucketLabels = ["0 - 20", "20 - 40", "40 - 60", "60 - 80", "80 - 100"];
  const maxScoreBucket = Math.max(...scoreDistribution, 1);

  // Flagged conversations
  const flaggedConversations = hasReal
    ? overview.recentReports
        .filter((r) => r.flags.length > 0)
        .map((r) => ({
          ticketId: r.ticketId,
          agent: "Agent",
          score: Math.round(r.scores.overall * 20),
          reason: r.flags[0]?.message ?? "Flagged",
          date: r.evaluatedAt.slice(0, 10),
        }))
    : demoFlaggedConversations();

  // Per-agent breakdown
  const agentBreakdown = hasReal
    ? (() => {
        const agentMap = new Map<
          string,
          { total: number; sum: number; flagged: number }
        >();
        for (const r of overview.recentReports) {
          const key = "Agent"; // no agent field on QAReport — grouped
          const entry = agentMap.get(key) ?? { total: 0, sum: 0, flagged: 0 };
          entry.total++;
          entry.sum += r.scores.overall * 20;
          if (r.flags.length > 0) entry.flagged++;
          agentMap.set(key, entry);
        }
        return Array.from(agentMap.entries()).map(([agent, data]) => ({
          agent,
          avgScore: Math.round(data.sum / data.total),
          totalScored: data.total,
          flagged: data.flagged,
          trend: "flat" as const,
        }));
      })()
    : demoAgentBreakdown();

  const trendIcon = (t: "up" | "down" | "flat") =>
    t === "up" ? "\u2191" : t === "down" ? "\u2193" : "\u2192";
  const trendColor = (t: "up" | "down" | "flat") =>
    t === "up"
      ? "text-emerald-600"
      : t === "down"
        ? "text-red-600"
        : "text-muted";

  const statCards = [
    { label: "Average Score", value: `${avgScore}` },
    { label: "Conversations Scored", value: totalScored.toLocaleString() },
    { label: "Flagged for Review", value: flaggedCount.toLocaleString() },
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
                href="/dashboard/qa/auto"
                className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground"
              >
                QA
              </Link>
            </div>
            <h1 className="mt-4 text-4xl font-bold">AutoQA Results</h1>
            {!hasReal && (
              <p className="mt-2 font-mono text-xs text-muted uppercase tracking-wider">
                Showing demo data
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Stat Cards */}
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
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

      {/* Score Distribution */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Score Distribution</h2>
        <div className="mt-6 space-y-4">
          {scoreBucketLabels.map((label, i) => {
            const count = scoreDistribution[i];
            const pct = Math.round((count / maxScoreBucket) * 100);
            return (
              <div key={label} className="flex items-center gap-4">
                <span className="w-20 shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-muted text-right">
                  {label}
                </span>
                <div className="flex-1 border-2 border-line bg-background">
                  <div
                    className="h-8 bg-foreground"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 font-mono text-sm font-bold text-right">
                  {count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Flagged Conversations */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Flagged Conversations</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="pb-3 pr-4 text-xs font-bold uppercase tracking-wider text-muted">
                  Ticket
                </th>
                <th className="pb-3 pr-4 text-xs font-bold uppercase tracking-wider text-muted">
                  Agent
                </th>
                <th className="pb-3 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Score
                </th>
                <th className="pb-3 pr-4 text-xs font-bold uppercase tracking-wider text-muted">
                  Flag Reason
                </th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {flaggedConversations.map((item, idx) => (
                <tr
                  key={`${item.ticketId}-${idx}`}
                  className="border-b border-line/40 hover:bg-accent-soft"
                >
                  <td className="py-3 pr-4 font-bold">{item.ticketId}</td>
                  <td className="py-3 pr-4">{item.agent}</td>
                  <td className="py-3 pr-4 text-right">
                    <span
                      className={`inline-block min-w-[3ch] px-2 py-0.5 text-center text-xs font-bold border-2 border-line ${
                        item.score < 40
                          ? "bg-red-500 text-white"
                          : item.score < 60
                            ? "bg-amber-400 text-black"
                            : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {item.score}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted max-w-xs truncate">
                    {item.reason}
                  </td>
                  <td className="py-3 text-right">{item.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-Agent Breakdown */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Per-Agent Breakdown</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted">
                  Agent
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Avg Score
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Total Scored
                </th>
                <th className="pb-3 pr-6 text-xs font-bold uppercase tracking-wider text-muted text-right">
                  Flagged
                </th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wider text-muted text-center">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody>
              {agentBreakdown.map((row) => (
                <tr
                  key={row.agent}
                  className="border-b border-line/40 hover:bg-accent-soft"
                >
                  <td className="py-3 pr-6 font-bold">{row.agent}</td>
                  <td className="py-3 pr-6 text-right">
                    <span
                      className={`inline-block min-w-[3ch] px-2 py-0.5 text-center text-xs font-bold border-2 border-line ${
                        row.avgScore >= 80
                          ? "bg-emerald-400 text-black"
                          : row.avgScore >= 60
                            ? "bg-amber-400 text-black"
                            : "bg-red-500 text-white"
                      }`}
                    >
                      {row.avgScore}
                    </span>
                  </td>
                  <td className="py-3 pr-6 text-right">{row.totalScored}</td>
                  <td className="py-3 pr-6 text-right">
                    {row.flagged > 0 ? (
                      <span className="font-bold">{row.flagged}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td
                    className={`py-3 text-center text-lg font-bold ${trendColor(row.trend)}`}
                  >
                    {trendIcon(row.trend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
