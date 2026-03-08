'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveMetrics } from '@/hooks/useLiveMetrics';

interface MetricDef {
  key: string;
  label: string;
  alertFn: (v: number) => boolean;
}

const METRIC_DEFS: MetricDef[] = [
  { key: 'openCount', label: 'Open Queue', alertFn: (v) => v > 20 },
  { key: 'slaBreaches', label: 'SLA Breached', alertFn: (v) => v > 0 },
  { key: 'slaWarnings', label: 'SLA At Risk', alertFn: (v) => v > 3 },
  { key: 'unassigned', label: 'Unassigned', alertFn: (v) => v > 5 },
  { key: 'agentsOnline', label: 'Agents Online', alertFn: () => false },
];

interface ServerValues {
  openCount: number;
  slaBreaches: number;
  slaWarnings: number;
  unassigned: number;
  agentsOnline: number;
  openCountAlert: boolean;
}

function formatLiveTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Animated metric value that briefly scales up when the number changes.
 */
function AnimatedValue({ value, alert }: { value: number; alert: boolean }) {
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 150);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span
      className={`text-4xl font-bold transition-transform duration-150 inline-block ${
        flash ? 'scale-105' : 'scale-100'
      } ${alert ? 'text-red-600' : 'text-zinc-950'}`}
    >
      {value}
    </span>
  );
}

/**
 * Overlay for Zone B alert strip. Connects to SSE and overlays live values
 * on top of server-rendered initial data. Falls back gracefully on disconnect.
 */
export default function LiveMetricStrip({ serverValues }: { serverValues: ServerValues }) {
  const { data, connected } = useLiveMetrics();

  // Use live data when connected, otherwise fall back to server values
  const metrics = data
    ? {
        openCount: data.openCount,
        slaBreaches: data.slaBreaches,
        slaWarnings: data.slaWarnings,
        unassigned: data.unassigned,
        agentsOnline: data.agentsOnline,
      }
    : {
        openCount: serverValues.openCount,
        slaBreaches: serverValues.slaBreaches,
        slaWarnings: serverValues.slaWarnings,
        unassigned: serverValues.unassigned,
        agentsOnline: serverValues.agentsOnline,
      };

  // For agents online alert: alert if no agents online AND there are open tickets
  const agentsOnlineAlert = metrics.agentsOnline === 0 && metrics.openCount > 0;

  const timestamp = data ? formatLiveTimestamp(data.timestamp) : null;

  return (
    <>
      {/* Live indicator + timestamp */}
      <div className="mt-4 flex items-center gap-2 font-mono text-[11px] text-muted">
        {connected ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-emerald-600 text-[10px] font-bold uppercase">
              Live
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-2 w-2 rounded-full bg-zinc-400" />
            <span className="text-zinc-400 text-[10px] font-bold uppercase">
              Offline
            </span>
          </span>
        )}
        {timestamp && (
          <span className="text-muted">as of {timestamp}</span>
        )}
      </div>

      {/* Metric cards */}
      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {METRIC_DEFS.map((def) => {
          const value = metrics[def.key as keyof typeof metrics];
          const isAlert =
            def.key === 'agentsOnline'
              ? agentsOnlineAlert
              : def.alertFn(value);

          return (
            <div key={def.key} className="border-2 border-zinc-950 bg-white p-6">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                {def.label}
              </p>
              <div className="mt-2 flex items-baseline">
                <AnimatedValue value={value} alert={isAlert} />
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
