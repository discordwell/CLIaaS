import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { runSyncCycle, getSyncStatus, listConnectors } from '../../sync/engine.js';

// Mock all connectors so tests never make real HTTP calls
const MOCK_MANIFEST = {
  source: 'test',
  exportedAt: new Date().toISOString(),
  counts: { tickets: 5, messages: 10, customers: 3, organizations: 1, kbArticles: 0, rules: 0 },
};

vi.mock('../../connectors/zendesk.js', () => ({
  exportZendesk: vi.fn().mockRejectedValue(new Error('Simulated connector failure')),
}));
vi.mock('../../connectors/freshdesk.js', () => ({
  exportFreshdesk: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/helpcrunch.js', () => ({
  exportHelpcrunch: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/groove.js', () => ({
  exportGroove: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/intercom.js', () => ({
  exportIntercom: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/helpscout.js', () => ({
  exportHelpScout: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/zoho-desk.js', () => ({
  exportZohoDesk: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));
vi.mock('../../connectors/hubspot.js', () => ({
  exportHubSpot: vi.fn().mockResolvedValue(MOCK_MANIFEST),
}));

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
    // Set auth so it gets past validation; the mocked exportZendesk will reject
    vi.stubEnv('ZENDESK_SUBDOMAIN', 'test-nonexistent-subdomain-xxxxx');
    vi.stubEnv('ZENDESK_EMAIL', 'test@test.com');
    vi.stubEnv('ZENDESK_TOKEN', 'fake-token-for-test');

    const stats = await runSyncCycle('zendesk', {
      outDir: TEST_DIR,
      fullSync: true,
    });

    // Should return stats with an error rather than throwing
    expect(stats.connector).toBe('zendesk');
    expect(stats.error).toBe('Simulated connector failure');
    expect(stats.fullSync).toBe(true);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Tests for the 7 newly-wired connectors ---

  const connectorEnvMap: Array<{
    name: string;
    envVars: Record<string, string>;
    missingEnvVars: Record<string, string>;
    expectedAuth: Record<string, string>;
    mockModule: string;
    mockFnName: string;
  }> = [
    {
      name: 'freshdesk',
      envVars: { FRESHDESK_DOMAIN: 'test.freshdesk.com', FRESHDESK_API_KEY: 'fk-test' },
      missingEnvVars: { FRESHDESK_DOMAIN: '', FRESHDESK_API_KEY: '' },
      expectedAuth: { subdomain: 'test.freshdesk.com', apiKey: 'fk-test' },
      mockModule: '../../connectors/freshdesk.js',
      mockFnName: 'exportFreshdesk',
    },
    {
      name: 'helpcrunch',
      envVars: { HELPCRUNCH_API_KEY: 'hc-test' },
      missingEnvVars: { HELPCRUNCH_API_KEY: '' },
      expectedAuth: { apiKey: 'hc-test' },
      mockModule: '../../connectors/helpcrunch.js',
      mockFnName: 'exportHelpcrunch',
    },
    {
      name: 'groove',
      envVars: { GROOVE_API_KEY: 'gv-test' },
      missingEnvVars: { GROOVE_API_KEY: '' },
      expectedAuth: { apiToken: 'gv-test' },
      mockModule: '../../connectors/groove.js',
      mockFnName: 'exportGroove',
    },
    {
      name: 'intercom',
      envVars: { INTERCOM_TOKEN: 'ic-test' },
      missingEnvVars: { INTERCOM_TOKEN: '' },
      expectedAuth: { accessToken: 'ic-test' },
      mockModule: '../../connectors/intercom.js',
      mockFnName: 'exportIntercom',
    },
    {
      name: 'helpscout',
      envVars: { HELPSCOUT_APP_ID: 'hs-id', HELPSCOUT_APP_SECRET: 'hs-secret' },
      missingEnvVars: { HELPSCOUT_APP_ID: '', HELPSCOUT_APP_SECRET: '' },
      expectedAuth: { appId: 'hs-id', appSecret: 'hs-secret' },
      mockModule: '../../connectors/helpscout.js',
      mockFnName: 'exportHelpScout',
    },
    {
      name: 'zoho-desk',
      envVars: { ZOHO_DESK_DOMAIN: 'desk.zoho.com', ZOHO_DESK_ORG_ID: 'org-123', ZOHO_DESK_TOKEN: 'zd-test' },
      missingEnvVars: { ZOHO_DESK_DOMAIN: '', ZOHO_DESK_ORG_ID: '', ZOHO_DESK_TOKEN: '' },
      expectedAuth: { orgId: 'org-123', accessToken: 'zd-test', apiDomain: 'desk.zoho.com' },
      mockModule: '../../connectors/zoho-desk.js',
      mockFnName: 'exportZohoDesk',
    },
    {
      name: 'hubspot',
      envVars: { HUBSPOT_TOKEN: 'hub-test' },
      missingEnvVars: { HUBSPOT_TOKEN: '' },
      expectedAuth: { accessToken: 'hub-test' },
      mockModule: '../../connectors/hubspot.js',
      mockFnName: 'exportHubSpot',
    },
  ];

  it.each(connectorEnvMap)(
    'syncs $name connector with correct auth mapping',
    async ({ name, envVars, expectedAuth, mockModule, mockFnName }) => {
      for (const [k, v] of Object.entries(envVars)) vi.stubEnv(k, v);
      const stats = await runSyncCycle(name, { outDir: TEST_DIR, fullSync: true });
      expect(stats.connector).toBe(name);
      expect(stats.error).toBeUndefined();
      expect(stats.counts.tickets).toBe(5);
      expect(stats.fullSync).toBe(true);

      // Verify the connector was called with correctly remapped auth fields
      const mod = await import(mockModule);
      expect(mod[mockFnName]).toHaveBeenCalledWith(expectedAuth, TEST_DIR);
    },
  );

  it.each(connectorEnvMap)(
    'throws missing auth for $name when env vars are empty',
    async ({ name, missingEnvVars }) => {
      for (const [k, v] of Object.entries(missingEnvVars)) vi.stubEnv(k, v);
      await expect(
        runSyncCycle(name, { outDir: TEST_DIR }),
      ).rejects.toThrow('Missing authentication');
    },
  );
});
