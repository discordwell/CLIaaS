import Link from 'next/link';
import { getSchedulesStore, getVolumeSnapshots, getStatusLog } from '@/lib/wfm/store';
import { getSwapRequests } from '@/lib/wfm/shift-swaps';
import { generateForecast, calculateStaffing } from '@/lib/wfm/forecast';
import { getCurrentAdherence } from '@/lib/wfm/adherence';
import { getIntradayStatus } from '@/lib/wfm/intraday';
import { agentStatusTracker } from '@/lib/wfm/agent-status';
import type { AgentCurrentStatus } from '@/lib/wfm/types';

export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function fmtHour(isoHour: string): string {
  try {
    const d = new Date(isoHour);
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  } catch {
    return isoHour.slice(11, 16);
  }
}

function gapColor(gap: number): string {
  if (gap <= 0) return 'text-emerald-600';
  if (gap <= 2) return 'text-amber-500';
  return 'text-red-600';
}

function gapLabel(gap: number): string {
  if (gap <= 0) return 'OK';
  if (gap <= 2) return 'WARN';
  return 'CRIT';
}

function adherenceColor(adherent: boolean): string {
  return adherent ? 'bg-emerald-500' : 'bg-red-500';
}

function statusLabel(status: AgentCurrentStatus): string {
  if (status.status === 'online') return 'On Schedule';
  if (status.status === 'away') return 'Away';
  if (status.status === 'on_break') return 'On Break';
  return 'Absent';
}

function statusDotColor(status: AgentCurrentStatus): string {
  if (status.status === 'online') return 'bg-emerald-500';
  if (status.status === 'away') return 'bg-amber-400';
  if (status.status === 'on_break') return 'bg-blue-400';
  return 'bg-zinc-400';
}

/* ------------------------------------------------------------------ */
/*  Data loader                                                        */
/* ------------------------------------------------------------------ */

function loadWfmData() {
  const schedules = getSchedulesStore();
  const snapshots = getVolumeSnapshots();
  const allStatuses = agentStatusTracker.getAllStatuses();
  const pendingSwaps = getSwapRequests({ status: 'pending' });

  // Forecast + staffing
  const forecast = generateForecast(snapshots, { daysAhead: 7 });
  const staffing = calculateStaffing(forecast, schedules);

  // Today's forecast slice (24 hours)
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayForecast = forecast.filter(fp => fp.hour.startsWith(todayStr));

  // Build actual volumes map from today's snapshots
  const actualVolumes = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.snapshotHour.startsWith(todayStr)) {
      actualVolumes.set(snap.snapshotHour, snap.ticketsCreated);
    }
  }

  // Build current staffing map
  const currentStaffing = new Map<string, number>();
  for (const rec of staffing) {
    if (rec.hour.startsWith(todayStr)) {
      currentStaffing.set(rec.hour, rec.scheduledAgents);
    }
  }

  // Intraday status
  const intraday = todayForecast.length > 0
    ? getIntradayStatus(todayForecast, actualVolumes, currentStaffing)
    : null;

  // Adherence
  const adherence = getCurrentAdherence(schedules, allStatuses);

  // Agents on shift: those with non-offline status
  const agentsOnShift = allStatuses.filter(s => s.status !== 'offline').length;

  // Adherence %
  const adherencePercent = adherence.length > 0
    ? Math.round((adherence.filter(a => a.adherent).length / adherence.length) * 100)
    : 100;

  // Coverage score: ratio of hours with no gap to total hours (today)
  const todayStaffing = staffing.filter(s => s.hour.startsWith(todayStr));
  const coveredHours = todayStaffing.filter(s => s.gap <= 0).length;
  const coverageScore = todayStaffing.length > 0
    ? Math.round((coveredHours / todayStaffing.length) * 100)
    : 100;

  // Build 7-day x 24-hour heatmap data
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const rec of staffing) {
    try {
      const d = new Date(rec.hour);
      const dow = d.getUTCDay();
      const hour = d.getUTCHours();
      heatmap[dow][hour] = Math.max(heatmap[dow][hour], rec.scheduledAgents);
    } catch { /* skip invalid */ }
  }

  // Determine max staffing for heatmap color scaling
  let maxStaffing = 1;
  for (const row of heatmap) {
    for (const val of row) {
      if (val > maxStaffing) maxStaffing = val;
    }
  }

  return {
    agentsOnShift,
    adherencePercent,
    coverageScore,
    pendingSwaps,
    intraday,
    todayStaffing,
    adherence,
    allStatuses,
    heatmap,
    maxStaffing,
    now,
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function WfmDashboardPage() {
  const {
    agentsOnShift,
    adherencePercent,
    coverageScore,
    pendingSwaps,
    intraday,
    todayStaffing,
    adherence,
    allStatuses,
    heatmap,
    maxStaffing,
    now,
  } = loadWfmData();

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const tzStr = 'UTC';

  const statCards = [
    { label: 'Agents On Shift', value: agentsOnShift },
    { label: 'Adherence %', value: `${adherencePercent}%` },
    { label: 'Coverage Score', value: `${coverageScore}%` },
    { label: 'Pending Swaps', value: pendingSwaps.length },
  ];

  /* Intraday table rows: merge snapshots + remaining staffing gaps */
  const intradayRows: Array<{
    hour: string;
    predicted: number;
    actual: number | null;
    variance: number | null;
    staffed: number;
    required: number;
    gap: number;
  }> = [];

  if (intraday) {
    // Observed hours
    for (const snap of intraday.snapshots) {
      const staffRec = todayStaffing.find(s => s.hour === snap.hour);
      intradayRows.push({
        hour: snap.hour,
        predicted: snap.predictedVolume,
        actual: snap.actualVolume,
        variance: snap.variance,
        staffed: staffRec?.scheduledAgents ?? 0,
        required: staffRec?.requiredAgents ?? 0,
        gap: staffRec?.gap ?? 0,
      });
    }
    // Remaining forecast hours
    for (const gap of intraday.staffingGaps) {
      const forecastPt = intraday.reforecast.remainingHours.find(fp => fp.hour === gap.hour);
      intradayRows.push({
        hour: gap.hour,
        predicted: forecastPt?.predictedVolume ?? 0,
        actual: null,
        variance: null,
        staffed: gap.currentStaffed,
        required: gap.requiredStaffed,
        gap: gap.gap,
      });
    }
  }

  // Sort by hour
  intradayRows.sort((a, b) => a.hour.localeCompare(b.hour));

  // Limit to 24 for display
  const displayRows = intradayRows.slice(0, 24);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">

      {/* ---- HEADER ---- */}
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              WFM
            </p>
            <h1 className="mt-4 text-4xl font-bold">Workforce Management</h1>
          </div>
          <div className="text-right font-mono">
            <p className="text-2xl font-bold tabular-nums">{timeStr}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-wider text-muted">{tzStr}</p>
          </div>
        </div>
      </header>

      {/* ---- STAT CARDS ---- */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map(s => (
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

      {/* ---- INTRADAY TABLE ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Intraday Forecast</h2>
        {intraday && (
          <p className="mt-2 font-mono text-xs text-muted">
            Adjustment factor: {intraday.reforecast.adjustmentFactor}x
            <span className={`ml-3 px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${
              intraday.reforecast.urgencyLevel === 'critical'
                ? 'bg-red-500 text-white'
                : intraday.reforecast.urgencyLevel === 'elevated'
                  ? 'bg-amber-400 text-black'
                  : 'bg-emerald-400 text-black'
            }`}>
              {intraday.reforecast.urgencyLevel}
            </span>
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted">Hour</th>
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">Predicted</th>
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">Actual</th>
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">Variance</th>
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">Staffed</th>
                <th className="pb-2 pr-4 text-xs font-bold uppercase tracking-wider text-muted text-right">Required</th>
                <th className="pb-2 text-xs font-bold uppercase tracking-wider text-muted text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length > 0 ? (
                displayRows.map(row => (
                  <tr key={row.hour} className="border-b border-zinc-200 hover:bg-accent-soft">
                    <td className="py-2 pr-4 font-bold">{fmtHour(row.hour)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.predicted.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.actual !== null ? row.actual.toFixed(1) : <span className="text-muted">--</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.variance !== null ? (
                        <span className={row.variance > 0 ? 'text-red-600' : row.variance < 0 ? 'text-emerald-600' : ''}>
                          {row.variance > 0 ? '+' : ''}{row.variance.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.staffed}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.required}</td>
                    <td className="py-2 text-right">
                      <span className={`font-bold ${gapColor(row.gap)}`}>
                        {row.gap > 0 ? `+${row.gap}` : row.gap === 0 ? '0' : String(row.gap)}
                      </span>
                      <span className={`ml-2 inline-block w-10 text-center px-1 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${
                        row.gap <= 0
                          ? 'bg-emerald-400 text-black'
                          : row.gap <= 2
                            ? 'bg-amber-400 text-black'
                            : 'bg-red-500 text-white'
                      }`}>
                        {gapLabel(row.gap)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No intraday data available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- STAFFING HEATMAP ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Staffing Heatmap</h2>
        <p className="mt-2 font-mono text-xs text-muted">
          7-day x 24-hour staffing levels. Darker = well-staffed, lighter = understaffed.
        </p>
        <div className="mt-4 overflow-x-auto">
          {/* Hour labels */}
          <div className="grid gap-px" style={{ gridTemplateColumns: '56px repeat(24, 1fr)' }}>
            <div className="h-5" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex items-center justify-center font-mono text-[10px] font-bold text-muted h-5">
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </div>
          {/* Day rows */}
          {[1, 2, 3, 4, 5, 6, 0].map(dow => (
            <div
              key={dow}
              className="grid gap-px mt-px"
              style={{ gridTemplateColumns: '56px repeat(24, 1fr)' }}
            >
              <div className="flex items-center font-mono text-xs font-bold text-muted pr-2 h-7">
                {DAY_LABELS[dow]}
              </div>
              {Array.from({ length: 24 }, (_, h) => {
                const val = heatmap[dow][h];
                const intensity = maxStaffing > 0 ? val / maxStaffing : 0;
                // Scale from light (understaffed/empty) to dark (well-staffed)
                const lightness = Math.round(95 - intensity * 70);
                const saturation = intensity > 0 ? 60 : 0;
                const hue = 152; // emerald-ish
                return (
                  <div
                    key={h}
                    className="h-7 border border-zinc-200 flex items-center justify-center font-mono text-[10px] font-bold"
                    style={{
                      backgroundColor: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
                      color: lightness < 50 ? '#fff' : '#71717a',
                    }}
                    title={`${DAY_LABELS[dow]} ${String(h).padStart(2, '0')}:00 — ${val} agent${val !== 1 ? 's' : ''}`}
                  >
                    {val > 0 ? val : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ---- ADHERENCE TIMELINE ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Adherence Timeline</h2>
        <div className="mt-4 flex flex-col gap-2 font-mono text-sm">
          {adherence.length > 0 ? (
            adherence.map(rec => {
              const agentStatus = allStatuses.find(s => s.userId === rec.userId);
              return (
                <div
                  key={rec.userId}
                  className="flex items-center justify-between border-2 border-line p-3 hover:bg-accent-soft"
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${adherenceColor(rec.adherent)}`} />
                    <span className="font-bold">{rec.userName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted uppercase">
                      Scheduled: {rec.scheduledActivity}
                    </span>
                    <span className="text-xs text-muted uppercase">
                      Actual: {rec.actualStatus}
                    </span>
                    {agentStatus && (
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${statusDotColor(agentStatus)}`} />
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${
                          rec.adherent
                            ? 'bg-emerald-400 text-black'
                            : 'bg-red-500 text-white'
                        }`}>
                          {statusLabel(agentStatus)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-6 text-center text-muted">
              No agents currently on shift.
            </p>
          )}
        </div>
      </section>

      {/* ---- SWAP QUEUE ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Swap Queue</h2>
        <div className="mt-4 flex flex-col gap-2 font-mono text-sm">
          {pendingSwaps.length > 0 ? (
            pendingSwaps.map(swap => (
              <div
                key={swap.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-2 border-line p-4 hover:bg-accent-soft"
              >
                <div className="flex-1">
                  <p className="font-bold">{swap.requesterName}</p>
                  <p className="mt-1 text-xs text-muted">
                    {swap.requesterShiftDate} &middot; {swap.requesterShiftStart}&ndash;{swap.requesterShiftEnd}
                    {swap.targetName && (
                      <span className="ml-2">
                        &rarr; {swap.targetName}
                      </span>
                    )}
                  </p>
                  {swap.reason && (
                    <p className="mt-1 text-xs text-muted italic">&ldquo;{swap.reason}&rdquo;</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line bg-amber-400 text-black">
                    {swap.status}
                  </span>
                  <button
                    type="button"
                    className="border-2 border-line bg-emerald-400 px-4 py-1.5 text-xs font-bold uppercase text-black hover:bg-emerald-500 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="border-2 border-line bg-red-500 px-4 py-1.5 text-xs font-bold uppercase text-white hover:bg-red-600 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-muted">
              No pending shift swap requests.
            </p>
          )}
        </div>
      </section>

      {/* ---- QUICK LINKS ---- */}
      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { href: '/dashboard/wfm/schedules', label: 'Schedule Editor', desc: 'Create and manage agent schedules' },
          { href: '/dashboard/wfm/forecast', label: 'Forecast', desc: 'Volume predictions and staffing models' },
          { href: '/dashboard/wfm/time-off', label: 'Time-Off Requests', desc: 'Review and approve PTO requests' },
        ].map(link => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col border-2 border-line bg-panel p-6 transition-colors hover:bg-accent-soft"
          >
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              {link.label}
            </span>
            <span className="mt-2 text-sm text-muted">
              {link.desc}
            </span>
            <span className="mt-4 font-mono text-xs font-bold text-foreground">
              {link.href} &rarr;
            </span>
          </Link>
        ))}
      </section>

    </main>
  );
}
