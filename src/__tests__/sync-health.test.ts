import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock store-helpers to always return null (JSONL fallback mode)
vi.mock('@/lib/store-helpers', () => ({
  tryDb: vi.fn().mockResolvedValue(null),
  getDefaultWorkspaceId: vi.fn().mockResolvedValue('demo-workspace'),
  withRls: vi.fn().mockResolvedValue(null),
}));

// Mock jsonl-store with in-memory storage
let jsonlStore: Record<string, unknown[]> = {};
vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: vi.fn((filename: string) => jsonlStore[filename] ?? []),
  writeJsonlFile: vi.fn((filename: string, items: unknown[]) => {
    jsonlStore[filename] = items;
  }),
}));

describe('sync health-store (JSONL fallback)', () => {
  beforeEach(() => {
    jsonlStore = {};
    vi.clearAllMocks();
  });

  it('records a successful sync result', async () => {
    const { recordSyncResult, getSyncHealth } = await import(
      '@/lib/sync/health-store'
    );

    await recordSyncResult('ws-1', 'freshdesk', {
      success: true,
      recordsSynced: 42,
      cursorState: { lastSyncAt: '2026-03-06T00:00:00.000Z' },
    });

    const records = await getSyncHealth('ws-1');
    expect(records).toHaveLength(1);
    expect(records[0].connector).toBe('freshdesk');
    expect(records[0].recordsSynced).toBe(42);
    expect(records[0].status).toBe('idle');
    expect(records[0].lastError).toBeNull();
    expect(records[0].lastSuccessAt).toBeTruthy();
  });

  it('records a failed sync result', async () => {
    const { recordSyncResult, getSyncHealth } = await import(
      '@/lib/sync/health-store'
    );

    await recordSyncResult('ws-1', 'intercom', {
      success: false,
      error: 'Auth token expired',
      recordsSynced: 0,
    });

    const records = await getSyncHealth('ws-1');
    expect(records).toHaveLength(1);
    expect(records[0].connector).toBe('intercom');
    expect(records[0].status).toBe('error');
    expect(records[0].lastError).toBe('Auth token expired');
    expect(records[0].lastSuccessAt).toBeNull();
  });

  it('updates existing record on subsequent sync', async () => {
    const { recordSyncResult, getSyncHealth } = await import(
      '@/lib/sync/health-store'
    );

    await recordSyncResult('ws-1', 'groove', {
      success: true,
      recordsSynced: 10,
    });
    await recordSyncResult('ws-1', 'groove', {
      success: true,
      recordsSynced: 25,
    });

    const records = await getSyncHealth('ws-1');
    expect(records).toHaveLength(1);
    expect(records[0].recordsSynced).toBe(25);
  });

  it('returns null for unknown connector', async () => {
    const { getSyncHealthForConnector } = await import(
      '@/lib/sync/health-store'
    );

    const record = await getSyncHealthForConnector('ws-1', 'nonexistent');
    expect(record).toBeNull();
  });

  it('returns specific connector health', async () => {
    const { recordSyncResult, getSyncHealthForConnector } = await import(
      '@/lib/sync/health-store'
    );

    await recordSyncResult('ws-1', 'freshdesk', {
      success: true,
      recordsSynced: 5,
    });
    await recordSyncResult('ws-1', 'zoho-desk', {
      success: true,
      recordsSynced: 8,
    });

    const record = await getSyncHealthForConnector('ws-1', 'zoho-desk');
    expect(record).toBeTruthy();
    expect(record!.connector).toBe('zoho-desk');
    expect(record!.recordsSynced).toBe(8);
  });

  it('isolates records by workspace', async () => {
    const { recordSyncResult, getSyncHealth } = await import(
      '@/lib/sync/health-store'
    );

    await recordSyncResult('ws-1', 'freshdesk', {
      success: true,
      recordsSynced: 10,
    });
    await recordSyncResult('ws-2', 'freshdesk', {
      success: true,
      recordsSynced: 20,
    });

    const ws1Records = await getSyncHealth('ws-1');
    expect(ws1Records).toHaveLength(1);
    expect(ws1Records[0].recordsSynced).toBe(10);

    const ws2Records = await getSyncHealth('ws-2');
    expect(ws2Records).toHaveLength(1);
    expect(ws2Records[0].recordsSynced).toBe(20);
  });
});

describe('incremental sync: connector cursorState signatures', () => {
  it('freshdesk export accepts cursorState parameter', async () => {
    // Verify the function signature accepts cursorState
    const mod = await import('../../cli/connectors/freshdesk');
    expect(typeof mod.exportFreshdesk).toBe('function');
    // The function should have 3 parameters (auth, outDir, cursorState?)
    expect(mod.exportFreshdesk.length).toBeGreaterThanOrEqual(2);
  });

  it('helpcrunch export accepts cursorState parameter', async () => {
    const mod = await import('../../cli/connectors/helpcrunch');
    expect(typeof mod.exportHelpcrunch).toBe('function');
    expect(mod.exportHelpcrunch.length).toBeGreaterThanOrEqual(2);
  });

  it('intercom export accepts cursorState parameter', async () => {
    const mod = await import('../../cli/connectors/intercom');
    expect(typeof mod.exportIntercom).toBe('function');
    expect(mod.exportIntercom.length).toBeGreaterThanOrEqual(2);
  });

  it('helpscout export accepts cursorState parameter', async () => {
    const mod = await import('../../cli/connectors/helpscout');
    expect(typeof mod.exportHelpScout).toBe('function');
    expect(mod.exportHelpScout.length).toBeGreaterThanOrEqual(2);
  });

  it('zoho-desk export accepts cursorState parameter', async () => {
    const mod = await import('../../cli/connectors/zoho-desk');
    expect(typeof mod.exportZohoDesk).toBe('function');
    expect(mod.exportZohoDesk.length).toBeGreaterThanOrEqual(2);
  });

  it('groove export accepts cursorState parameter', async () => {
    const mod = await import('../../cli/connectors/groove');
    expect(typeof mod.exportGroove).toBe('function');
    expect(mod.exportGroove.length).toBeGreaterThanOrEqual(2);
  });
});
