import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { runSyncCycle, getSyncStatus, listConnectors } from '../../sync/engine.js';

const TEST_DIR = join(process.cwd(), 'tmp-test-sync');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('listConnectors', () => {
  it('returns all supported connector names', () => {
    const connectors = listConnectors();
    expect(connectors).toContain('zendesk');
    expect(connectors).toContain('kayako');
    expect(connectors).toContain('kayako-classic');
    expect(connectors.length).toBeGreaterThan(3);
  });
});

describe('getSyncStatus', () => {
  it('returns statuses for all known connectors', () => {
    const statuses = getSyncStatus();
    expect(statuses.length).toBeGreaterThan(0);
    // Every status should have the expected shape
    for (const s of statuses) {
      expect(s.connector).toBeDefined();
      expect(typeof s.ticketCount).toBe('number');
    }
  });

  it('returns status for a specific connector', () => {
    const statuses = getSyncStatus('zendesk');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].connector).toBe('zendesk');
  });

  it('reads cursor state from existing manifest', () => {
    const outDir = './exports/zendesk';
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'manifest.json'),
      JSON.stringify({
        source: 'zendesk',
        exportedAt: '2026-02-24T10:00:00Z',
        counts: { tickets: 42, messages: 100, customers: 10, organizations: 3, kbArticles: 5, rules: 2 },
        cursorState: { ticketCursor: 'abc123', userCursor: 'def456' },
      }),
    );

    try {
      const statuses = getSyncStatus('zendesk');
      expect(statuses).toHaveLength(1);
      expect(statuses[0].lastSyncedAt).toBe('2026-02-24T10:00:00Z');
      expect(statuses[0].ticketCount).toBe(42);
      expect(statuses[0].cursorState).toEqual({
        ticketCursor: 'abc123',
        userCursor: 'def456',
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('runSyncCycle', () => {
  it('throws for unknown connector', async () => {
    await expect(runSyncCycle('nonexistent')).rejects.toThrow('Unknown connector');
  });

  it('returns error when auth is missing', async () => {
    // Clear all env vars that would provide auth
    vi.stubEnv('ZENDESK_SUBDOMAIN', '');
    vi.stubEnv('ZENDESK_EMAIL', '');
    vi.stubEnv('ZENDESK_TOKEN', '');

    await expect(
      runSyncCycle('zendesk', { outDir: TEST_DIR }),
    ).rejects.toThrow('Missing authentication');
  });

  it('returns error stats when connector export fails', async () => {
    // Set auth so it gets past validation but the API call will fail
    vi.stubEnv('ZENDESK_SUBDOMAIN', 'test-nonexistent-subdomain-xxxxx');
    vi.stubEnv('ZENDESK_EMAIL', 'test@test.com');
    vi.stubEnv('ZENDESK_TOKEN', 'fake-token-for-test');

    const stats = await runSyncCycle('zendesk', {
      outDir: TEST_DIR,
      fullSync: true,
    });

    // Should return stats with an error rather than throwing
    expect(stats.connector).toBe('zendesk');
    expect(stats.error).toBeDefined();
    expect(stats.fullSync).toBe(true);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});
