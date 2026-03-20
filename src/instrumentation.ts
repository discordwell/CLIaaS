/**
 * Next.js instrumentation hook — runs once at server startup.
 * Loads Sentry server config and starts BullMQ workers.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      await import('../sentry.server.config');
    } catch {
      // Sentry instrumentation may fail in cross-platform deploys
      // (macOS build → Linux runtime). Safe to skip when SENTRY_DSN is unset.
    }

    // Start BullMQ workers (no-op if Redis unavailable).
    // Wrapped in try-catch: Turbopack externalizes ioredis/bullmq with hashed names
    // that may not resolve on the VPS. Workers are optional — the app works without them.
    try {
      const { startAllWorkers, stopAllWorkers } = await import('./lib/queue/workers/index');
      startAllWorkers();

      // Graceful shutdown — drain workers before exit
      const shutdown = async () => {
        await stopAllWorkers();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    } catch (e) {
      console.warn('[instrumentation] BullMQ workers unavailable (ioredis/bullmq not bundled):', (e as Error).message);
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    try {
      await import('../sentry.edge.config');
    } catch {
      // Same cross-platform issue as above
    }
  }
}
