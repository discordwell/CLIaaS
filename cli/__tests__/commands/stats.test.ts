import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeSampleTickets, makeSampleMessages, makeKBArticle } from './_fixtures.js';

const sampleTickets = makeSampleTickets();
const sampleMessages = makeSampleMessages();
const sampleArticles = [makeKBArticle()];

vi.mock('../../data.js', () => ({
  loadTickets: vi.fn(() => sampleTickets),
  loadMessages: vi.fn(() => sampleMessages),
  loadKBArticles: vi.fn(() => sampleArticles),
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

// Mock fs.existsSync for manifest loading
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
  };
});

const { registerStatsCommand } = await import('../../commands/stats.js');
const outputMod = await import('../../output.js');

describe('stats command', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerStatsCommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('computes correct overview statistics', async () => {
    await program.parseAsync(['node', 'cliaas', 'stats']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(data.overview.tickets).toBe(5);
    expect(data.overview.messages).toBe(4);
    expect(data.overview.kbArticles).toBe(1);
  });

  it('breaks down tickets by status', async () => {
    await program.parseAsync(['node', 'cliaas', 'stats']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.byStatus.open).toBe(3);
    expect(data.byStatus.pending).toBe(1);
    expect(data.byStatus.solved).toBe(1);
  });

  it('breaks down tickets by priority', async () => {
    await program.parseAsync(['node', 'cliaas', 'stats']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.byPriority.urgent).toBe(1);
    expect(data.byPriority.high).toBe(2);
    expect(data.byPriority.normal).toBe(1);
    expect(data.byPriority.low).toBe(1);
  });

  it('identifies urgent open tickets in alerts', async () => {
    await program.parseAsync(['node', 'cliaas', 'stats']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.alerts.urgentOpenCount).toBe(2);
    expect(data.alerts.urgentOpen.length).toBe(2);
  });

  it('computes top tags', async () => {
    await program.parseAsync(['node', 'cliaas', 'stats']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.topTags).toBeDefined();
    expect(data.topTags.login).toBe(1);
  });

  it('outputs structured JSON', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'stats']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('overview');
    expect(data).toHaveProperty('byStatus');
    expect(data).toHaveProperty('byPriority');
    expect(data).toHaveProperty('byAssignee');
    expect(data).toHaveProperty('alerts');
  });
});
