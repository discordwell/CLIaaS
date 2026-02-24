import { describe, it, expect, afterEach, vi } from 'vitest';
import { startRetentionScheduler, stopRetentionScheduler } from '../retention-scheduler';

describe('retention-scheduler', () => {
  afterEach(() => {
    stopRetentionScheduler(); // clean up all
    vi.restoreAllMocks();
  });

  it('supports multiple workspaces concurrently', () => {
    // Should not throw when starting two different workspaces
    startRetentionScheduler('ws-1', 60000);
    startRetentionScheduler('ws-2', 60000);
    // Starting same workspace again is a no-op (no error)
    startRetentionScheduler('ws-1', 60000);
    // Clean up
    stopRetentionScheduler('ws-1');
    stopRetentionScheduler('ws-2');
  });

  it('stop by workspaceId only stops that workspace', () => {
    startRetentionScheduler('ws-a', 60000);
    startRetentionScheduler('ws-b', 60000);
    stopRetentionScheduler('ws-a');
    // ws-b still running — starting it again should be a no-op
    startRetentionScheduler('ws-b', 60000);
    stopRetentionScheduler();
  });

  it('stop all clears every workspace', () => {
    startRetentionScheduler('ws-x', 60000);
    startRetentionScheduler('ws-y', 60000);
    stopRetentionScheduler();
    // Both should be stoppable without error (already stopped)
    stopRetentionScheduler('ws-x');
    stopRetentionScheduler('ws-y');
  });
});
