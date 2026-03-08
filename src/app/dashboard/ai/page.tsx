import Link from 'next/link';
import { getAgentConfig } from '@/lib/ai/store';
import { getAgentStats } from '@/lib/ai/agent';
import { getROIMetrics } from '@/lib/ai/roi-tracker';
import { getPendingApprovals } from '@/lib/ai/approval-queue';
import {
  getCircuitBreakerStatusAsync,
  getAuditTrailAsync,
  getChannelPoliciesAsync,
  type CircuitBreakerState,
} from '@/lib/ai/admin-controls';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function loadDashboardData() {
  const workspaceId = 'demo-workspace';
  const config = await getAgentConfig(workspaceId);
  const agentStats = getAgentStats();
  const roi = getROIMetrics();
  const pendingApprovals = await getPendingApprovals();
  const circuitBreaker = await getCircuitBreakerStatusAsync(workspaceId);
  const { entries: auditEntries } = await getAuditTrailAsync({ workspaceId, limit: 5 });
  const channelPolicies = await getChannelPoliciesAsync(workspaceId);

  const activeChannels = channelPolicies.filter(p => p.enabled).length;

  // CSAT impact: difference between AI-resolved avg and baseline (simulated)
  const csatDelta = roi.aiResolved > 0 ? +2.4 : 0;

  return {
    config,
    agentStats,
    roi,
    pendingApprovals,
    circuitBreaker,
    auditEntries,
    activeChannels,
    csatDelta,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ enabled, mode }: { enabled: boolean; mode: string }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 border-2 border-line bg-zinc-200 px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-zinc-600">
        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
        Disabled
      </span>
    );
  }
  const modeColors: Record<string, string> = {
    auto: 'bg-emerald-400 text-black',
    approve: 'bg-amber-400 text-black',
    suggest: 'bg-sky-400 text-black',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 border-2 border-line px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${modeColors[mode] ?? 'bg-zinc-200 text-zinc-600'}`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-black/20" />
      Active &mdash; {mode}
    </span>
  );
}

function CircuitBreakerIndicator({ state }: { state: CircuitBreakerState }) {
  const stateConfig: Record<string, { bg: string; ring: string; label: string; desc: string }> = {
    closed: {
      bg: 'bg-emerald-400',
      ring: 'ring-emerald-400/30',
      label: 'Closed',
      desc: 'All systems nominal. AI requests flowing normally.',
    },
    half_open: {
      bg: 'bg-amber-400',
      ring: 'ring-amber-400/30',
      label: 'Half Open',
      desc: 'Recovery in progress. Limited requests allowed.',
    },
    open: {
      bg: 'bg-red-500',
      ring: 'ring-red-500/30',
      label: 'Open',
      desc: 'Circuit tripped. AI requests are blocked.',
    },
  };

  const cfg = stateConfig[state.state] ?? stateConfig.closed;

  return (
    <div className="border-2 border-line bg-panel p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Circuit Breaker
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`relative inline-block h-4 w-4 rounded-full ${cfg.bg} ring-4 ${cfg.ring}`}>
              {state.state === 'closed' && (
                <span className={`absolute inset-0 inline-block h-4 w-4 animate-ping rounded-full ${cfg.bg} opacity-40`} />
              )}
            </span>
            <span className="font-mono text-lg font-bold uppercase tracking-wider">
              {cfg.label}
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-muted">{cfg.desc}</p>
        </div>
        <div className="text-right font-mono text-xs text-muted">
          {state.failureCount > 0 && (
            <p>
              Failures: <span className="font-bold text-foreground">{state.failureCount}</span>
            </p>
          )}
          {state.lastFailureAt && (
            <p className="mt-1">
              Last trip:{' '}
              <span className="font-bold text-foreground">
                {new Date(state.lastFailureAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </p>
          )}
          {state.lastSuccessAt && (
            <p className="mt-1">
              Last OK:{' '}
              <span className="font-bold text-foreground">
                {new Date(state.lastSuccessAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  auto_resolved: 'Auto-resolved',
  escalated: 'Escalated',
  pending: 'Pending',
  edited: 'Edited',
  error: 'Error',
};

const ACTION_COLORS: Record<string, string> = {
  approved: 'bg-emerald-400 text-black',
  auto_resolved: 'bg-emerald-400 text-black',
  rejected: 'bg-red-500 text-white',
  escalated: 'bg-amber-400 text-black',
  pending: 'bg-sky-400 text-black',
  edited: 'bg-violet-400 text-black',
  error: 'bg-red-500 text-white',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AIOverviewPage() {
  const {
    config,
    agentStats,
    roi,
    pendingApprovals,
    circuitBreaker,
    auditEntries,
    activeChannels,
    csatDelta,
  } = await loadDashboardData();

  const statCards = [
    {
      label: 'Resolution Rate',
      value: `${roi.resolutionRate}%`,
      detail: `${roi.aiResolved} of ${roi.totalResolutions} tickets`,
    },
    {
      label: 'CSAT Impact',
      value: csatDelta > 0 ? `+${csatDelta}` : `${csatDelta}`,
      detail: csatDelta !== 0 ? 'vs. human-only baseline' : 'No data yet',
    },
    {
      label: 'Active Channels',
      value: `${activeChannels}`,
      detail: `${config.channels.length} configured`,
    },
    {
      label: 'Tickets Processed',
      value: `${agentStats.totalRuns}`,
      detail: 'today',
    },
  ];

  const quickActions = [
    { href: '/dashboard/ai/setup', label: 'Setup & Config', desc: 'Provider, model, thresholds' },
    { href: '/dashboard/ai/channels', label: 'Channel Policies', desc: 'Per-channel AI rules' },
    { href: '/dashboard/ai/performance', label: 'Performance', desc: 'Latency, cost, accuracy' },
    { href: '/dashboard/ai/safety', label: 'Safety & Guardrails', desc: 'PII, circuit breaker, limits' },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* ---- HEADER ---- */}
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              AI Command Center
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight">
              Autonomous Resolution Engine
            </h1>
            <p className="mt-2 font-mono text-sm text-muted">
              Real-time oversight of AI-driven ticket resolution, safety controls, and audit compliance.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <StatusBadge enabled={config.enabled} mode={config.mode} />
            {pendingApprovals.length > 0 && (
              <Link
                href="/dashboard/ai/setup"
                className="border-2 border-line bg-amber-400 px-4 py-1.5 font-mono text-xs font-bold uppercase text-black transition-colors hover:bg-amber-300"
              >
                {pendingApprovals.length} Pending Review
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ---- STAT CARDS ---- */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map(s => (
          <div key={s.label} className="border-2 border-line bg-panel p-5 text-center">
            <p className="font-mono text-3xl font-bold">{s.value}</p>
            <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
              {s.label}
            </p>
            <p className="mt-2 font-mono text-[10px] text-muted">{s.detail}</p>
          </div>
        ))}
      </section>

      {/* ---- CIRCUIT BREAKER ---- */}
      <section className="mt-8">
        <CircuitBreakerIndicator state={circuitBreaker} />
      </section>

      {/* ---- RECENT ACTIVITY TABLE ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Recent Activity</h2>
          <span className="font-mono text-xs text-muted">Last 10 actions</span>
        </div>
        <div className="mt-6">
          {agentStats.recentResults.length === 0 ? (
            <p className="py-8 text-center font-mono text-sm text-muted">
              No AI activity recorded yet. Configure the AI agent to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-sm">
                <thead>
                  <tr className="border-b-2 border-line text-left">
                    <th className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Ticket
                    </th>
                    <th className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Action
                    </th>
                    <th className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-muted">
                      Confidence
                    </th>
                    <th className="pb-3 text-[10px] font-bold uppercase tracking-wider text-muted">
                      KB Articles
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agentStats.recentResults.slice(0, 10).map((r, i) => {
                    const status = r.escalated
                      ? 'escalated'
                      : r.resolved
                        ? 'auto_resolved'
                        : 'pending';
                    return (
                      <tr key={`${r.ticketId}-${i}`} className="border-b border-line/50 last:border-b-0">
                        <td className="py-3 pr-4 font-bold">#{r.ticketId}</td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase ${ACTION_COLORS[status] ?? 'bg-zinc-200 text-zinc-700'}`}
                          >
                            {ACTION_LABELS[status] ?? status}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-bold">{Math.round(r.confidence * 100)}%</span>
                        </td>
                        <td className="py-3 text-xs text-muted">
                          {r.kbArticlesUsed.length > 0
                            ? r.kbArticlesUsed.join(', ')
                            : '\u2014'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---- QUICK ACTIONS ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Quick Actions</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {quickActions.map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex flex-col border-2 border-line p-5 transition-colors hover:bg-accent-soft"
            >
              <span className="font-mono text-sm font-bold text-foreground group-hover:underline">
                {a.label}
              </span>
              <span className="mt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                {a.desc}
              </span>
              <span className="mt-auto pt-3 font-mono text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100">
                &rarr;
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- AUDIT TRAIL ---- */}
      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Audit Trail</h2>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              Immutable log of all AI decisions and configuration changes.
            </p>
          </div>
          <span className="font-mono text-xs text-zinc-500">Recent 5 entries</span>
        </div>
        <div className="mt-6">
          {auditEntries.length === 0 ? (
            <p className="py-6 text-center font-mono text-sm text-zinc-500">
              No audit entries recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {auditEntries.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        entry.action.includes('approved') || entry.action.includes('auto_sent') || entry.action.includes('reset')
                          ? 'bg-emerald-400 text-black'
                          : entry.action.includes('rejected') || entry.action.includes('error') || entry.action.includes('opened')
                            ? 'bg-red-500 text-white'
                            : entry.action.includes('escalated')
                              ? 'bg-amber-400 text-black'
                              : 'bg-zinc-700 text-zinc-100'
                      }`}
                    >
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                    {entry.ticketId && (
                      <span className="font-mono text-xs text-zinc-500">#{entry.ticketId}</span>
                    )}
                    {entry.userId && (
                      <span className="font-mono text-xs text-zinc-600">by {entry.userId}</span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {new Date(entry.timestamp).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- ROI SUMMARY FOOTER ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">ROI Summary</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-emerald-600">
              {roi.estimatedTimeSavedMinutes}m
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              Time Saved
            </p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold">
              ${(roi.avgCostPerResolution).toFixed(2)}
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              Avg Cost / Resolution
            </p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold">
              {Math.round(agentStats.avgConfidence * 100)}%
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              Avg Confidence
            </p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-amber-600">
              {agentStats.escalated}
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              Escalations
            </p>
          </div>
        </div>
      </section>

      {/* ---- CLI REFERENCE ---- */}
      <section className="mt-8 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">CLI Reference</h2>
        <div className="mt-6 flex flex-col gap-4 font-mono text-sm">
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas ai stats</span>
            <span className="text-zinc-500">View AI resolution metrics</span>
          </div>
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas ai config</span>
            <span className="text-zinc-500">Show or update AI config</span>
          </div>
          <div className="flex justify-between border-b-2 border-zinc-800 pb-4">
            <span className="text-emerald-400">cliaas ai approve &lt;id&gt;</span>
            <span className="text-zinc-500">Approve pending resolution</span>
          </div>
          <div className="flex justify-between">
            <span className="text-emerald-400">cliaas ai reject &lt;id&gt;</span>
            <span className="text-zinc-500">Reject and escalate to human</span>
          </div>
        </div>
      </section>
    </main>
  );
}
