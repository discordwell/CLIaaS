import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the engine module
const mockRunSyncCycle = vi.fn();
vi.mock('../../sync/engine.js', () => ({
  runSyncCycle: (...args: unknown[]) => mockRunSyncCycle(...args),
  CONNECTOR_DEFAULTS: {
    zendesk: { outDir: './exports/zendesk' },
  },
}));

// Mock the DB availability check
const mockIsDatabaseAvailable = vi.fn();
vi.mock('../../../src/db/index.js', () => ({
  isDatabaseAvailable: () => mockIsDatabaseAvailable(),
}));

// Mock the ingest function
const mockIngest = vi.fn();
vi.mock('../../../src/lib/zendesk/ingest.js', () => ({
  ingestZendeskExportDir: (...args: unknown[]) => mockIngest(...args),
}));

import { syncAndIngest } from '../../sync/pull.js';

const MOCK_STATS = {
  connector: 'zendesk',
  startedAt: '2026-03-05T00:00:00.000Z',
  finishedAt: '2026-03-05T00:00:01.000Z',
  durationMs: 1000,
  counts: { tickets: 5, messages: 10, customers: 3, organizations: 1, kbArticles: 0, rules: 0 },
  fullSync: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRunSyncCycle.mockResolvedValue(MOCK_STATS);
  mockIsDatabaseAvailable.mockReturnValue(true);
  mockIngest.mockResolvedValue(undefined);
});

describe('syncAndIngest', () => {
  it('only exports when ingest is false', async () => {
    const result = await syncAndIngest('zendesk', { ingest: false });

    expect(mockRunSyncCycle).toHaveBeenCalledWith('zendesk', { ingest: false });
    expect(mockIngest).not.toHaveBeenCalled();
    expect(result.ingested).toBe(false);
    expect(result.ingestSkipped).toBe(false);
    expect(result.counts.tickets).toBe(5);
  });

  it('only exports when ingest is not specified', async () => {
    const result = await syncAndIngest('zendesk');

    expect(mockRunSyncCycle).toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(result.ingested).toBe(false);
  });

  it('skips ingest when DB is not available', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false);

    const result = await syncAndIngest('zendesk', { ingest: true });

    expect(mockRunSyncCycle).toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(result.ingested).toBe(false);
    expect(result.ingestSkipped).toBe(true);
  });

  it('ingests when DB is available and ingest is true', async () => {
    const result = await syncAndIngest('zendesk', { ingest: true });

    expect(mockRunSyncCycle).toHaveBeenCalled();
    expect(mockIngest).toHaveBeenCalledWith({
      dir: './exports/zendesk',
      tenant: 'default',
      workspace: 'default',
      provider: 'zendesk',
    });
    expect(result.ingested).toBe(true);
    expect(result.ingestSkipped).toBe(false);
  });

  it('passes tenant and workspace options', async () => {
    await syncAndIngest('zendesk', {
      ingest: true,
      tenant: 'acme',
      workspace: 'prod',
    });

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'acme',
        workspace: 'prod',
      }),
    );
  });

  it('does not ingest when export has an error', async () => {
    mockRunSyncCycle.mockResolvedValue({
      ...MOCK_STATS,
      error: 'Auth failed',
    });

    const result = await syncAndIngest('zendesk', { ingest: true });

    expect(mockIngest).not.toHaveBeenCalled();
    expect(result.ingested).toBe(false);
    expect(result.error).toBe('Auth failed');
  });

  it('returns ingestError when ingest throws', async () => {
    mockIngest.mockRejectedValue(new Error('DB connection lost'));

    const result = await syncAndIngest('zendesk', { ingest: true });

    expect(result.ingested).toBe(false);
    expect(result.ingestError).toBe('DB connection lost');
  });

  it('uses outDir override when provided', async () => {
    await syncAndIngest('zendesk', {
      ingest: true,
      outDir: '/custom/dir',
    });

    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: '/custom/dir',
      }),
    );
  });
});
