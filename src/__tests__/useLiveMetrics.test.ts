/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLiveMetrics } from '@/hooks/useLiveMetrics';

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  addEventListener(type: string, handler: (ev: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (ev: MessageEvent) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
    }
  }

  close() {
    this.readyState = 2;
  }

  // Test helper: simulate a message event
  _emit(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    (this.listeners[type] || []).forEach((h) => h(event));
  }

  // Test helper: simulate an error
  _error() {
    this.onerror?.(new Event('error'));
  }
}

const originalEventSource = globalThis.EventSource;

describe('useLiveMetrics', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as unknown as Record<string, unknown>).EventSource =
      MockEventSource as unknown as typeof EventSource;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as Record<string, unknown>).EventSource =
      originalEventSource;
  });

  it('starts disconnected with null data', () => {
    const { result } = renderHook(() => useLiveMetrics());

    expect(result.current.data).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('connects to the SSE endpoint', async () => {
    renderHook(() => useLiveMetrics());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/dashboard/stream');
  });

  it('updates data when a metrics event is received', async () => {
    const { result } = renderHook(() => useLiveMetrics());

    const es = MockEventSource.instances[0];

    // Wait for onopen to fire
    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    const payload = {
      openCount: 5,
      pendingCount: 3,
      urgentCount: 1,
      slaBreaches: 2,
      slaWarnings: 1,
      unassigned: 4,
      agentsOnline: 2,
      timestamp: '2026-03-08T15:00:00Z',
    };

    act(() => {
      es._emit('metrics', JSON.stringify(payload));
    });

    expect(result.current.data).toEqual(payload);
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets error state on connection error', async () => {
    const { result } = renderHook(() => useLiveMetrics());

    // Wait for open
    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    const es = MockEventSource.instances[0];

    act(() => {
      es._error();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe('Connection lost');
  });

  it('reconnects with exponential backoff after error', async () => {
    const { result } = renderHook(() => useLiveMetrics());

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    // First connection
    expect(MockEventSource.instances).toHaveLength(1);

    // Trigger error
    act(() => {
      MockEventSource.instances[0]._error();
    });

    // After 1s (initial backoff), should reconnect
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toBe('/api/dashboard/stream');
  });

  it('closes EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useLiveMetrics());

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    const es = MockEventSource.instances[0];
    expect(es.readyState).toBe(1); // open

    unmount();
    expect(es.readyState).toBe(2); // closed
  });

  it('preserves previous data when new data arrives', async () => {
    const { result } = renderHook(() => useLiveMetrics());

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    const es = MockEventSource.instances[0];

    const payload1 = {
      openCount: 5,
      pendingCount: 3,
      urgentCount: 1,
      slaBreaches: 2,
      slaWarnings: 1,
      unassigned: 4,
      agentsOnline: 2,
      timestamp: '2026-03-08T15:00:00Z',
    };

    act(() => {
      es._emit('metrics', JSON.stringify(payload1));
    });

    expect(result.current.data?.openCount).toBe(5);

    const payload2 = {
      ...payload1,
      openCount: 8,
      timestamp: '2026-03-08T15:00:15Z',
    };

    act(() => {
      es._emit('metrics', JSON.stringify(payload2));
    });

    expect(result.current.data?.openCount).toBe(8);
    expect(result.current.data?.pendingCount).toBe(3); // unchanged
  });
});
