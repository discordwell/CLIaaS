/**
 * Sync Worker — simple interval-based loop that calls runSyncCycle repeatedly.
 *
 * No Redis dependency. Just a setInterval with error handling.
 */

import { runSyncCycle, type SyncStats } from './engine.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface WorkerOptions {
  intervalMs?: number;
  outDir?: string;
  onCycle?: (stats: SyncStats) => void;
  onError?: (error: Error) => void;
}

interface WorkerHandle {
  stop: () => void;
  /** Returns true if the worker is currently running. */
  isRunning: () => boolean;
}

/**
 * Start a continuous sync worker for a connector.
 * Returns a handle to stop the worker.
 */
export function startSyncWorker(
  connectorName: string,
  opts?: WorkerOptions,
): WorkerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentCycle: Promise<void> | null = null;

  const log = (msg: string) => {
    process.stderr.write(`[sync-worker:${connectorName}] ${msg}\n`);
  };

  const cycle = async () => {
    if (!running) return;

    try {
      log(`Starting sync cycle...`);
      const stats = await runSyncCycle(connectorName, { outDir: opts?.outDir });

      if (stats.error) {
        log(`Cycle completed with error: ${stats.error}`);
        opts?.onError?.(new Error(stats.error));
      } else {
        log(
          `Cycle complete: ${stats.counts.tickets} tickets, ${stats.counts.messages} messages (${stats.durationMs}ms)`,
        );
        opts?.onCycle?.(stats);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log(`Cycle failed: ${error.message}`);
      opts?.onError?.(error);
    }

    // Schedule next cycle only if still running
    if (running) {
      timer = setTimeout(() => {
        currentCycle = cycle();
      }, intervalMs);
    }
  };

  // Start the first cycle immediately
  currentCycle = cycle();

  return {
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      log('Worker stopped');
    },
    isRunning() {
      return running;
    },
  };
}
