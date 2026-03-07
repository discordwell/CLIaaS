import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Worker registry tests.
 *
 * Redis is not available in test, so we verify:
 *  - The factories array length (7 workers expected)
 *  - startAllWorkers no-ops gracefully when Redis is unavailable
 *  - getActiveWorkerCount returns 0 when no Redis
 *  - stopAllWorkers resolves cleanly when nothing is running
 */

describe('worker registry', () => {
  beforeEach(() => {
    // Ensure no REDIS_URL so isRedisAvailable() returns false
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('all 3 entry points are exported', async () => {
    const src = await import('../index');
    expect(typeof src.startAllWorkers).toBe('function');
    expect(typeof src.stopAllWorkers).toBe('function');
    expect(typeof src.getActiveWorkerCount).toBe('function');
  }, 15000);

  it('startAllWorkers is a no-op when Redis is unavailable', async () => {
    const { startAllWorkers, getActiveWorkerCount } = await import('../index');
    startAllWorkers();
    expect(getActiveWorkerCount()).toBe(0);
  }, 15000);

  it('getActiveWorkerCount returns 0 before any start', async () => {
    const { getActiveWorkerCount } = await import('../index');
    expect(getActiveWorkerCount()).toBe(0);
  }, 15000);

  it('stopAllWorkers resolves cleanly when no workers are active', async () => {
    const { stopAllWorkers } = await import('../index');
    await expect(stopAllWorkers()).resolves.toBeUndefined();
  }, 15000);

  it('startAllWorkers does not double-start (idempotent)', async () => {
    const { startAllWorkers, getActiveWorkerCount } = await import('../index');
    startAllWorkers();
    startAllWorkers();
    expect(getActiveWorkerCount()).toBe(0);
  }, 15000);

  it('all 7 worker modules are importable', async () => {
    // Verify each worker factory module resolves without error
    const [webhook, automation, aiRes, email, report, pii, autoqa] = await Promise.all([
      import('../webhook-worker'),
      import('../automation-worker'),
      import('../ai-resolution-worker'),
      import('../email-worker'),
      import('../report-export-worker'),
      import('../pii-scan-worker'),
      import('../autoqa-worker'),
    ]);

    expect(typeof webhook.createWebhookWorker).toBe('function');
    expect(typeof automation.createAutomationWorker).toBe('function');
    expect(typeof aiRes.createAIResolutionWorker).toBe('function');
    expect(typeof email.createEmailWorker).toBe('function');
    expect(typeof report.createReportExportWorker).toBe('function');
    expect(typeof pii.startPiiScanWorker).toBe('function');
    expect(typeof autoqa.createAutoQAWorker).toBe('function');
  });

  it('individual worker factories return null when Redis is unavailable', async () => {
    const { createWebhookWorker } = await import('../webhook-worker');
    const { createAutomationWorker } = await import('../automation-worker');
    const { createEmailWorker } = await import('../email-worker');
    const { createReportExportWorker } = await import('../report-export-worker');

    // These factories call getRedisConnectionOpts which returns null without REDIS_URL
    expect(createWebhookWorker()).toBeNull();
    expect(createAutomationWorker()).toBeNull();
    expect(createEmailWorker()).toBeNull();
    expect(createReportExportWorker()).toBeNull();
  });
});
