'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface DashboardMetrics {
  openCount: number;
  pendingCount: number;
  urgentCount: number;
  slaBreaches: number;
  slaWarnings: number;
  unassigned: number;
  agentsOnline: number;
  timestamp: string;
}

interface UseLiveMetricsResult {
  data: DashboardMetrics | null;
  connected: boolean;
  error: string | null;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Connects to the dashboard SSE stream and returns live metrics.
 * Auto-reconnects on disconnect with exponential backoff (max 30s).
 * Cleans up EventSource on unmount.
 */
export function useLiveMetrics(): UseLiveMetricsResult {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    // Don't reconnect if unmounted
    if (!mountedRef.current) return;

    // Close any existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource('/api/dashboard/stream');
    esRef.current = es;

    es.addEventListener('metrics', (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const metrics: DashboardMetrics = JSON.parse(event.data);
        setData(metrics);
        setConnected(true);
        setError(null);
        // Reset backoff on successful message
        backoffRef.current = INITIAL_BACKOFF_MS;
      } catch {
        // Malformed JSON -- ignore this event
      }
    });

    es.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
      backoffRef.current = INITIAL_BACKOFF_MS;
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      setError('Connection lost');

      // Close the errored connection
      es.close();
      esRef.current = null;

      // Schedule reconnect with exponential backoff
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { data, connected, error };
}
