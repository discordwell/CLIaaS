import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';

const mockSyncStats = {
  connector: 'zendesk',
  startedAt: '2026-03-01T10:00:00Z',
  finishedAt: '2026-03-01T10:01:00Z',
  durationMs: 60000,
  counts: {
    tickets: 150,
    messages: 500,
    customers: 80,
    organizations: 10,
    kbArticles: 25,
    rules: 5,
  },
  cursorState: { tickets: '2026-03-01T10:01:00Z' },
  fullSync: false,
};

const mockSyncStatuses = [
  {
    connector: 'zendesk',
    lastSyncedAt: '2026-03-01T09:00:00Z',
    cursorState: { tickets: '2026-03-01T09:00:00Z' },
    ticketCount: 100,
  },
  {
    connector: 'kayako',
    lastSyncedAt: null,
    cursorState: null,
    ticketCount: 0,
  },
];

vi.mock('../../sync/engine.js', () => ({
  runSyncCycle: vi.fn().mockResolvedValue(mockSyncStats),
  getSyncStatus: vi.fn((name?: string) => {
    if (name) return mockSyncStatuses.filter(s => s.connector === name);
    return mockSyncStatuses;
  }),
  listConnectors: vi.fn(() => ['zendesk', 'kayako', 'kayako-classic', 'freshdesk', 'groove']),
}));

vi.mock('../../sync/worker.js', () => ({
  startSyncWorker: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

vi.mock('../../output.js', async () => {
  let _jsonMode = false;
  return {
    setJsonMode: (enabled: boolean) => { _jsonMode = enabled; },
    isJsonMode: () => _jsonMode,
    output: vi.fn((data: unknown, humanFn: (d: unknown) => void) => {
      if (!_jsonMode) humanFn(data);
    }),
    outputError: vi.fn(),
    info: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    })),
  };
});

const { registerSyncCommands } = await import('../../commands/sync.js');
const outputMod = await import('../../output.js');
const syncEngine = await import('../../sync/engine.js');

describe('sync status', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSyncCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('shows status for all connectors', async () => {
    await program.parseAsync(['node', 'cliaas', 'sync', 'status']);

    expect(syncEngine.getSyncStatus).toHaveBeenCalledWith(undefined);
    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.connectors).toHaveLength(2);
    expect(data.connectors[0].connector).toBe('zendesk');
    expect(data.connectors[0].ticketCount).toBe(100);
  });

  it('filters by connector name', async () => {
    await program.parseAsync(['node', 'cliaas', 'sync', 'status', '--connector', 'zendesk']);

    expect(syncEngine.getSyncStatus).toHaveBeenCalledWith('zendesk');
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.connectors).toHaveLength(1);
    expect(data.connectors[0].connector).toBe('zendesk');
  });

  it('outputs structured JSON', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'sync', 'status']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('connectors');
    expect(data.connectors[0]).toHaveProperty('connector');
    expect(data.connectors[0]).toHaveProperty('lastSyncedAt');
    expect(data.connectors[0]).toHaveProperty('ticketCount');
    expect(data.connectors[0]).toHaveProperty('cursors');
  });
});

describe('sync run', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSyncCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit'); }) as never);
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('runs sync cycle successfully', async () => {
    await program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk']);

    expect(syncEngine.runSyncCycle).toHaveBeenCalledWith('zendesk', {
      fullSync: false,
      outDir: undefined,
    });
    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.connector).toBe('zendesk');
    expect(data.counts.tickets).toBe(150);
  });

  it('passes --full flag to sync engine', async () => {
    await program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk', '--full']);

    expect(syncEngine.runSyncCycle).toHaveBeenCalledWith('zendesk', {
      fullSync: true,
      outDir: undefined,
    });
  });

  it('passes --out directory', async () => {
    await program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk', '--out', '/tmp/test']);

    expect(syncEngine.runSyncCycle).toHaveBeenCalledWith('zendesk', {
      fullSync: false,
      outDir: '/tmp/test',
    });
  });

  it('handles sync error in stats', async () => {
    (syncEngine.runSyncCycle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockSyncStats,
      error: 'Connection refused',
    });

    await expect(
      program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk']),
    ).rejects.toThrow('process.exit');

    expect(outputMod.outputError).toHaveBeenCalled();
  });

  it('handles sync exception', async () => {
    (syncEngine.runSyncCycle as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk']),
    ).rejects.toThrow('process.exit');

    expect(outputMod.outputError).toHaveBeenCalled();
  });

  it('outputs JSON for sync run', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'sync', 'run', '--connector', 'zendesk']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('connector', 'zendesk');
    expect(data).toHaveProperty('durationMs');
    expect(data).toHaveProperty('counts');
  });
});
