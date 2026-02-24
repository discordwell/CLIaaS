import { describe, it, expect, vi, afterEach } from 'vitest';
import { startSyncWorker } from '../../sync/worker.js';

// Mock the engine so we don't make real API calls
vi.mock('../../sync/engine.js', () => ({
  runSyncCycle: vi.fn().mockResolvedValue({
    connector: 'zendesk',
    startedAt: '2026-02-24T10:00:00Z',
    finishedAt: '2026-02-24T10:00:01Z',
    durationMs: 1000,
    counts: { tickets: 5, messages: 10, customers: 2, organizations: 1, kbArticles: 0, rules: 0 },
    fullSync: false,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startSyncWorker', () => {
  it('starts and can be stopped', async () => {
    const onCycle = vi.fn();

    const handle = startSyncWorker('zendesk', {
      intervalMs: 100,
      onCycle,
    });

    expect(handle.isRunning()).toBe(true);

    // Wait for the first cycle to complete
    await new Promise(r => setTimeout(r, 200));

    handle.stop();
    expect(handle.isRunning()).toBe(false);

    // onCycle should have been called at least once
    expect(onCycle).toHaveBeenCalled();
    const stats = onCycle.mock.calls[0][0];
    expect(stats.connector).toBe('zendesk');
    expect(stats.counts.tickets).toBe(5);
  });

  it('calls onError when sync fails', async () => {
    const { runSyncCycle } = await import('../../sync/engine.js');
    const mockedRun = vi.mocked(runSyncCycle);
    mockedRun.mockResolvedValueOnce({
      connector: 'zendesk',
      startedAt: '2026-02-24T10:00:00Z',
      finishedAt: '2026-02-24T10:00:01Z',
      durationMs: 1000,
      counts: { tickets: 0, messages: 0, customers: 0, organizations: 0, kbArticles: 0, rules: 0 },
      fullSync: false,
      error: 'API rate limited',
    });

    const onError = vi.fn();
    const onCycle = vi.fn();

    const handle = startSyncWorker('zendesk', {
      intervalMs: 100,
      onCycle,
      onError,
    });

    // Wait for the first cycle
    await new Promise(r => setTimeout(r, 200));
    handle.stop();

    // onError should have been called for the first cycle
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toBe('API rate limited');
  });

  it('does not schedule next cycle after stop', async () => {
    const onCycle = vi.fn();

    const handle = startSyncWorker('zendesk', {
      intervalMs: 50,
      onCycle,
    });

    // Let first cycle finish
    await new Promise(r => setTimeout(r, 100));
    handle.stop();

    const callCount = onCycle.mock.calls.length;
    // Wait to make sure no more cycles run
    await new Promise(r => setTimeout(r, 200));
    expect(onCycle.mock.calls.length).toBe(callCount);
  });
});
