'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import LiveMetricCard from '@/components/LiveMetricCard';

interface LiveSnapshot {
  queueDepth: Record<string, number>;
  agentsOnline: number;
  avgWaitHours: number;
  createdLastHour: number;
  resolvedLastHour: number;
  slaAtRisk: number;
  timestamp: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const RECONNECT_DELAY = 3000;
const POLL_INTERVAL = 30_000;

/**
 * Live dashboard content — connects to the SSE stream at /api/dashboard/live
 * and displays real-time metric tiles. Falls back to polling if SSE fails.
 */
export default function LiveDashboardContent() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previousSnapshot, setPreviousSnapshot] = useState<LiveSnapshot | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseFailedRef = useRef(false);

  const handleSnapshot = useCallback((data: LiveSnapshot) => {
    setPreviousSnapshot(prev => prev ?? null);
    setSnapshot(current => {
      setPreviousSnapshot(current);
      return data;
    });
    setLastUpdated(new Date());
    setStatus('connected');
  }, []);

  // Polling fallback
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;

    const poll = async () => {
      try {
        const res = await fetch('/api/dashboard/live/snapshot');
        if (res.ok) {
          const data: LiveSnapshot = await res.json();
          handleSnapshot(data);
        }
      } catch {
        setStatus('disconnected');
      }
    };

    poll(); // immediate first poll
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL);
  }, [handleSnapshot]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // SSE connection
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus('connecting');
    const es = new EventSource('/api/dashboard/live');
    eventSourceRef.current = es;

    es.addEventListener('snapshot', (event: MessageEvent) => {
      try {
        const data: LiveSnapshot = JSON.parse(event.data);
        handleSnapshot(data);
        sseFailedRef.current = false;
        stopPolling();
      } catch {
        // Malformed data — ignore
      }
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setStatus('disconnected');

      if (!sseFailedRef.current) {
        // First failure — try reconnecting via SSE
        sseFailedRef.current = true;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
      } else {
        // Repeated failure — fall back to polling
        startPolling();
      }
    };
  }, [handleSnapshot, startPolling, stopPolling]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      stopPolling();
    };
  }, [connect, stopPolling]);

  // Compute simple trends by comparing current and previous snapshots
  function getTrend(
    current: number | undefined,
    previous: number | undefined,
  ): 'up' | 'down' | 'flat' {
    if (current === undefined || previous === undefined) return 'flat';
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'flat';
  }

  const queueTotal = snapshot
    ? (snapshot.queueDepth.open ?? 0) + (snapshot.queueDepth.pending ?? 0)
    : 0;
  const prevQueueTotal = previousSnapshot
    ? (previousSnapshot.queueDepth.open ?? 0) + (previousSnapshot.queueDepth.pending ?? 0)
    : undefined;

  return (
    <div
      className={`mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950 ${
        isFullscreen ? 'fixed inset-0 z-50 max-w-none bg-zinc-100' : ''
      }`}
    >
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Dashboard</h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            Real-time workspace metrics
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                status === 'connected'
                  ? 'bg-green-500'
                  : status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-red-500'
              }`}
              aria-label={`Connection status: ${status}`}
            />
            <span className="font-mono text-xs text-zinc-500">{status}</span>
          </div>

          {/* Last updated */}
          {lastUpdated && (
            <span className="font-mono text-xs text-zinc-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(f => !f)}
            className="border-2 border-zinc-950 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-950 hover:text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {/* Metric tiles */}
      {snapshot ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <LiveMetricCard
            label="Queue Depth"
            value={queueTotal}
            trend={getTrend(queueTotal, prevQueueTotal)}
          />
          <LiveMetricCard
            label="Agents Online"
            value={snapshot.agentsOnline}
            trend={getTrend(snapshot.agentsOnline, previousSnapshot?.agentsOnline)}
          />
          <LiveMetricCard
            label="Avg Wait Time"
            value={snapshot.avgWaitHours}
            unit="hrs"
            trend={getTrend(snapshot.avgWaitHours, previousSnapshot?.avgWaitHours)}
          />
          <LiveMetricCard
            label="Created Last Hour"
            value={snapshot.createdLastHour}
            trend={getTrend(snapshot.createdLastHour, previousSnapshot?.createdLastHour)}
          />
          <LiveMetricCard
            label="Resolved Last Hour"
            value={snapshot.resolvedLastHour}
            trend={getTrend(snapshot.resolvedLastHour, previousSnapshot?.resolvedLastHour)}
          />
          <LiveMetricCard
            label="SLA At Risk"
            value={snapshot.slaAtRisk}
            trend={getTrend(snapshot.slaAtRisk, previousSnapshot?.slaAtRisk)}
            alert={snapshot.slaAtRisk > 0}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse border-2 border-zinc-300 bg-zinc-50 p-6"
            >
              <div className="h-3 w-24 bg-zinc-200" />
              <div className="mt-4 h-10 w-20 bg-zinc-200" />
            </div>
          ))}
        </div>
      )}

      {/* Queue breakdown */}
      {snapshot && (
        <div className="mt-6 border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
            Queue Breakdown
          </p>
          <div className="mt-3 flex gap-6">
            {Object.entries(snapshot.queueDepth).map(([status, count]) => (
              <div key={status} className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-zinc-950">{count}</span>
                <span className="font-mono text-xs text-zinc-500">{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Snapshot timestamp */}
      {snapshot && (
        <p className="mt-4 font-mono text-xs text-zinc-400">
          Snapshot: {new Date(snapshot.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}
