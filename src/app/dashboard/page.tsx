import Link from "next/link";
import { loadTickets, computeStats, loadMessages, loadKBArticles } from "@/lib/data";
import { getAllConnectorStatuses } from "@/lib/connector-service";
import { availability } from "@/lib/routing/availability";
import { checkAllTicketsSLA } from "@/lib/sla";
import type { SLACheckResult } from "@/lib/sla";
import { detectKBGapsLocal } from "@/lib/kb/content-gaps";
import { computeAnalytics } from "@/lib/analytics";
import type { Ticket } from "@/lib/data";
import LiveMetricStrip from "@/components/LiveMetricStrip";
import NumberCard from "@/components/charts/NumberCard";

export const dynamic = "force-dynamic";

// ---- Inline helpers ----

function formatHours(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h * 10) / 10}h`;
  const days = Math.floor(h / 24);
  const remainHours = Math.round(h % 24);
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function trendDirection(
  current: number,
  previous: number,
  invert = false,
): "up" | "down" | "flat" {
  if (current === previous || (current === 0 && previous === 0)) return "flat";
  const improving = invert ? current < previous : current > previous;
  return improving ? "up" : "down";
}

function formatMinutesRemaining(minutes: number): string {
  if (minutes >= 0) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }
  const elapsed = Math.abs(minutes);
  const h = Math.floor(elapsed / 60);
  const m = Math.round(elapsed % 60);
  return h > 0 ? `BREACHED ${h}h ${m}m ago` : `BREACHED ${m}m ago`;
}

interface ActionableTicket {
  ticket: Ticket;
  sla: SLACheckResult | undefined;
  urgencyScore: number;
  slaLabel: string;
}

function getActionableTickets(
  tickets: Ticket[],
  slaResults: SLACheckResult[],
): ActionableTicket[] {
  const slaMap = new Map(slaResults.map((r) => [r.ticketId, r]));
  const actionable = tickets.filter(
    (t) =>
      t.status === "open" || t.status === "pending" || t.status === "on_hold",
  );

  return actionable
    .map((ticket) => {
      const sla = slaMap.get(ticket.id);
      let urgencyScore = 0;
      let slaLabel = "---";

      if (sla) {
        const breached =
          sla.firstResponse.status === "breached" ||
          sla.resolution.status === "breached";
        const warning =
          sla.firstResponse.status === "warning" ||
          sla.resolution.status === "warning";

        if (breached) {
          const worstRemaining = Math.min(
            sla.firstResponse.remainingMinutes,
            sla.resolution.remainingMinutes,
          );
          urgencyScore = 10000 + Math.abs(worstRemaining);
          slaLabel = formatMinutesRemaining(worstRemaining);
        } else if (warning) {
          const worstRemaining = Math.min(
            sla.firstResponse.remainingMinutes,
            sla.resolution.remainingMinutes,
          );
          urgencyScore = 5000 + (1000 - Math.min(worstRemaining, 1000));
          slaLabel = formatMinutesRemaining(worstRemaining);
        } else {
          const worstRemaining = Math.min(
            sla.firstResponse.remainingMinutes,
            sla.resolution.remainingMinutes,
          );
          slaLabel = formatMinutesRemaining(worstRemaining);
        }
      }

      if (ticket.priority === "urgent") urgencyScore += 300;
      else if (ticket.priority === "high") urgencyScore += 200;

      if (!ticket.assignee) urgencyScore += 100;

      return { ticket, sla, urgencyScore, slaLabel };
    })
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 10);
}

// ---- Main page ----

export default async function DashboardPage() {
  const tickets = await loadTickets();
  const stats = computeStats(tickets);
  const connectors = getAllConnectorStatuses();

  const allAvailability = availability.getAllAvailability();
  const availCounts = { online: 0, away: 0, offline: 0 };
  for (const entry of allAvailability) {
    availCounts[entry.status]++;
  }

  const [messages, kbArticles] = await Promise.all([
    loadMessages(),
    loadKBArticles(),
  ]);
  const kbGaps = detectKBGapsLocal(tickets, messages, kbArticles);

  const slaResults = await checkAllTicketsSLA(tickets, messages);
  const slaBreaches = slaResults.filter(
    (r) =>
      r.firstResponse.status === "breached" ||
      r.resolution.status === "breached",
  ).length;
  const slaWarnings = slaResults.filter(
    (r) =>
      r.firstResponse.status === "warning" ||
      r.resolution.status === "warning",
  ).length;

  const analytics = await computeAnalytics(undefined, { tickets, messages });

  const openCount = stats.byStatus["open"] ?? 0;
  const unassigned = stats.byAssignee["unassigned"] ?? 0;
  const totalTickets = stats.total;

  const actionableTickets = getActionableTickets(tickets, slaResults);

  // SLA compliance %
  const slaMet = analytics.firstResponseSLA.met + analytics.resolutionSLA.met;
  const slaTotal =
    slaMet +
    analytics.firstResponseSLA.breached +
    analytics.resolutionSLA.breached;
  const slaCompliancePct =
    slaTotal > 0 ? Math.round((slaMet / slaTotal) * 100) : 0;

  // CSAT trend
  const csatTrendInfo = (() => {
    if (analytics.csatTrend.length < 2)
      return { direction: "flat" as const, delta: "" };
    const first = analytics.csatTrend[0].score;
    const last =
      analytics.csatTrend[analytics.csatTrend.length - 1].score;
    const diff = Math.round((last - first) * 100) / 100;
    const sign = diff >= 0 ? "+" : "";
    return {
      direction: trendDirection(last, first),
      delta: `${sign}${diff} from ${first}`,
    };
  })();

  // Period comparison shortcuts
  const pc = analytics.periodComparison;

  // Volume chart: last 14 days
  const volumeData = analytics.ticketsCreated.slice(-14);
  const maxVolume = Math.max(...volumeData.map((d) => d.count), 1);

  const activeConnectors = connectors.filter(
    (c) => c.configured || c.hasExport,
  );

  // ---- Empty state tier ----
  const tier =
    totalTickets === 0 ? "empty" : totalTickets < 10 ? "sparse" : "full";

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10 text-foreground">
      {/* ===== ZONE A: Slim Header ===== */}
      <header className="flex items-center justify-between border-b-2 border-line pb-4">
        <div className="flex items-baseline gap-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em]">
            Control Plane
          </p>
        </div>
        <Link
          href="/settings"
          className="font-mono text-xs font-bold uppercase text-muted transition-colors hover:text-foreground"
        >
          Settings
        </Link>
      </header>

      {/* ===== ZONE B: Alert Strip ===== */}
      {tier === "empty" ? (
        <section className="mt-6 border-2 border-line bg-panel p-8">
          <h2 className="text-2xl font-bold">Welcome to CLIaaS</h2>
          <p className="mt-2 font-mono text-sm text-muted">
            No tickets yet. Connect a helpdesk or create your first ticket
            to get started.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/connectors"
              className="border-2 border-line px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-accent-soft"
            >
              Connect Helpdesk
            </Link>
            <Link
              href="/tickets/new"
              className="border-2 border-line px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-accent-soft"
            >
              Create Ticket
            </Link>
          </div>
          {activeConnectors.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {activeConnectors.map((c) => (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-1.5 border-2 border-line px-3 py-1 font-mono text-[10px] font-bold uppercase ${
                    c.configured
                      ? "bg-emerald-400 text-black"
                      : "bg-yellow-400 text-black"
                  }`}
                >
                  {c.name}: {c.configured ? "Active" : "Export Only"}
                </span>
              ))}
            </div>
          )}
        </section>
      ) : (
        <LiveMetricStrip
          serverValues={{
            openCount,
            slaBreaches,
            slaWarnings,
            unassigned,
            agentsOnline: availCounts.online,
            openCountAlert: openCount > 20,
          }}
        />
      )}

      {/* ===== ZONE C: Actionable Tickets ===== */}
      {tier !== "empty" && (
        <section className="mt-6 border-2 border-line bg-panel p-6">
          <h2 className="text-lg font-bold">What Needs Attention</h2>
          {actionableTickets.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1.5 font-mono text-sm">
              {actionableTickets.map(({ ticket: t, slaLabel }) => (
                <Link
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="flex items-center justify-between border-2 border-line p-3 transition-colors hover:bg-accent-soft"
                >
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {t.subject}
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-2">
                    <span
                      className={`border-2 border-line px-2 py-0.5 text-[10px] font-bold uppercase ${
                        t.priority === "urgent"
                          ? "bg-red-500 text-white"
                          : t.priority === "high"
                            ? "bg-orange-400 text-black"
                            : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {t.priority}
                    </span>
                    <span
                      className={`border-2 border-line px-2 py-0.5 text-[10px] font-bold uppercase ${
                        t.status === "open"
                          ? "bg-emerald-400 text-black"
                          : t.status === "pending"
                            ? "bg-yellow-400 text-black"
                            : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {t.status}
                    </span>
                    <span
                      className={`text-[11px] font-bold ${
                        !t.assignee ? "text-red-600" : "text-muted"
                      }`}
                    >
                      {t.assignee ?? "Unassigned"}
                    </span>
                    <span
                      className={`text-[11px] ${
                        slaLabel.startsWith("BREACHED")
                          ? "font-bold text-red-600"
                          : "text-muted"
                      }`}
                    >
                      {slaLabel}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-3 font-mono text-sm text-muted">
              All clear. No tickets need attention right now.
            </p>
          )}
        </section>
      )}

      {/* ===== ZONE D: Performance Metrics ===== */}
      {tier !== "empty" && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-bold">Performance</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NumberCard
              label="Avg First Response"
              value={
                analytics.avgResponseTimeHours > 0
                  ? formatHours(analytics.avgResponseTimeHours)
                  : "---"
              }
              trend={
                pc.previous.avgResponseHours > 0
                  ? {
                      direction: trendDirection(
                        analytics.avgResponseTimeHours,
                        pc.previous.avgResponseHours,
                        true,
                      ),
                      value: pctChange(
                        analytics.avgResponseTimeHours,
                        pc.previous.avgResponseHours,
                      ),
                    }
                  : undefined
              }
            />
            <NumberCard
              label="Avg Resolution"
              value={
                analytics.avgResolutionTimeHours > 0
                  ? formatHours(analytics.avgResolutionTimeHours)
                  : "---"
              }
            />
            <NumberCard
              label="CSAT"
              value={
                analytics.csatOverall > 0
                  ? `${analytics.csatOverall} / 5`
                  : "---"
              }
              trend={
                analytics.csatTrend.length >= 2
                  ? {
                      direction: csatTrendInfo.direction,
                      value: csatTrendInfo.delta,
                    }
                  : undefined
              }
            />
            <NumberCard
              label="SLA Compliance"
              value={slaTotal > 0 ? `${slaCompliancePct}%` : "---"}
              trend={
                slaTotal > 0
                  ? {
                      direction: slaCompliancePct >= 95 ? "up" : slaCompliancePct >= 80 ? "flat" : "down",
                      value: `${slaMet}/${slaTotal} met`,
                    }
                  : undefined
              }
            />
          </div>

          {/* Agent Leaderboard + Top Issues */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* Agent Leaderboard */}
            <div className="border-2 border-line bg-panel p-5">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Agent Leaderboard
              </p>
              {analytics.agentPerformance.length > 0 ? (
                <table className="mt-3 w-full font-mono text-sm">
                  <thead>
                    <tr className="border-b-2 border-line text-left text-[10px] font-bold uppercase text-muted">
                      <th className="pb-2">Agent</th>
                      <th className="pb-2 text-right">Handled</th>
                      <th className="pb-2 text-right">Avg Res.</th>
                      <th className="pb-2 text-right">CSAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.agentPerformance
                      .slice(0, 5)
                      .map((agent) => (
                        <tr
                          key={agent.name}
                          className="border-b border-line/50"
                        >
                          <td className="py-2 font-bold">
                            {agent.name}
                          </td>
                          <td className="py-2 text-right">
                            {agent.ticketsHandled}
                          </td>
                          <td className="py-2 text-right">
                            {agent.avgResolutionHours > 0
                              ? formatHours(agent.avgResolutionHours)
                              : "---"}
                          </td>
                          <td className="py-2 text-right">
                            {agent.csatAvg > 0
                              ? agent.csatAvg.toFixed(1)
                              : "---"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-3 font-mono text-sm text-muted">
                  No data yet.
                </p>
              )}
            </div>

            {/* Top Issues */}
            <div className="border-2 border-line bg-panel p-5">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Top Issues
              </p>
              {analytics.topTags.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {analytics.topTags.slice(0, 5).map((tag) => {
                    const maxTagCount = analytics.topTags[0].count;
                    const widthPct = Math.max(
                      Math.round((tag.count / maxTagCount) * 100),
                      8,
                    );
                    return (
                      <div
                        key={tag.tag}
                        className="flex items-center gap-3 font-mono text-sm"
                      >
                        <span className="w-28 shrink-0 truncate font-bold">
                          {tag.tag}
                        </span>
                        <div className="relative h-5 flex-1 border border-zinc-200 bg-zinc-100">
                          <div
                            className="absolute inset-y-0 left-0 bg-zinc-800"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-muted">
                          {tag.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 font-mono text-sm text-muted">
                  No data yet.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===== ZONE E: Trends ===== */}
      {tier === "full" && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-bold">Trends</h2>

          {/* Volume chart: CSS bars */}
          {volumeData.length > 0 && (
            <div className="border-2 border-line bg-panel p-5">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Ticket Volume (Last 14 Days)
              </p>
              <div
                className="mt-3 flex items-end gap-1"
                style={{ height: "120px" }}
              >
                {volumeData.map((d) => {
                  const heightPct = Math.max(
                    (d.count / maxVolume) * 100,
                    4,
                  );
                  return (
                    <div
                      key={d.date}
                      className="flex h-full flex-1 flex-col items-center justify-end"
                    >
                      <span className="mb-1 font-mono text-[9px] text-muted">
                        {d.count > 0 ? d.count : ""}
                      </span>
                      <div
                        className="min-h-[2px] w-full bg-zinc-800"
                        style={{ height: `${heightPct}%` }}
                        title={`${d.date}: ${d.count} tickets`}
                      />
                      <span className="mt-1 origin-top-left rotate-[-45deg] whitespace-nowrap font-mono text-[8px] text-muted">
                        {d.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Period comparison */}
          <div className="mt-4 border-2 border-line bg-panel p-5">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              This Week vs Last Week
            </p>
            <div className="mt-3 grid grid-cols-3 gap-4 font-mono text-sm">
              {[
                {
                  label: "Created",
                  current: pc.current.tickets,
                  previous: pc.previous.tickets,
                  invert: false,
                },
                {
                  label: "Resolved",
                  current: pc.current.resolved,
                  previous: pc.previous.resolved,
                  invert: false,
                },
                {
                  label: "Avg Response",
                  current: pc.current.avgResponseHours,
                  previous: pc.previous.avgResponseHours,
                  invert: true,
                },
              ].map((item) => {
                const dir = trendDirection(
                  item.current,
                  item.previous,
                  item.invert,
                );
                const colorClass =
                  dir === "up"
                    ? "text-emerald-600"
                    : dir === "down"
                      ? "text-red-600"
                      : "text-muted";
                return (
                  <div key={item.label}>
                    <p className="text-[10px] font-bold uppercase text-muted">
                      {item.label}
                    </p>
                    <p className="mt-1 text-xl font-bold">
                      {item.label === "Avg Response"
                        ? item.current > 0
                          ? formatHours(item.current)
                          : "---"
                        : item.current}
                    </p>
                    <p
                      className={`text-xs font-bold ${colorClass}`}
                    >
                      {item.previous > 0
                        ? pctChange(item.current, item.previous)
                        : "---"}{" "}
                      vs{" "}
                      {item.label === "Avg Response"
                        ? item.previous > 0
                          ? formatHours(item.previous)
                          : "---"
                        : item.previous}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* KB Gaps (conditional) */}
          {kbGaps.length > 0 && (
            <div className="mt-4 border-2 border-line bg-panel p-5">
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Knowledge Base Gaps
              </p>
              <div className="mt-3 space-y-2 font-mono text-sm">
                {kbGaps.slice(0, 3).map((gap) => (
                  <Link
                    key={gap.topic}
                    href="/kb"
                    className="flex items-center justify-between py-1 text-muted transition-colors hover:text-foreground"
                  >
                    <span className="font-bold text-foreground">
                      {gap.topic}
                    </span>
                    <span className="text-xs">
                      {gap.ticketCount} ticket
                      {gap.ticketCount !== 1 ? "s" : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ===== ZONE F: Connectors (compact footer) ===== */}
      {tier !== "empty" && activeConnectors.length > 0 && (
        <section className="mt-6 flex flex-wrap gap-2">
          {activeConnectors.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center gap-1.5 border-2 border-line px-3 py-1 font-mono text-[10px] font-bold uppercase ${
                c.configured
                  ? "bg-emerald-400 text-black"
                  : "bg-yellow-400 text-black"
              }`}
            >
              {c.name}: {c.configured ? "Active" : "Export Only"}
            </span>
          ))}
        </section>
      )}
    </main>
  );
}
