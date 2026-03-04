import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeSampleTickets, makeSampleMessages } from './_fixtures.js';

const sampleTickets = makeSampleTickets();
const sampleMessages = makeSampleMessages();

vi.mock('../../data.js', () => ({
  loadTickets: vi.fn(() => sampleTickets),
  loadMessages: vi.fn(() => sampleMessages),
  getTicketMessages: vi.fn((ticketId: string, messages: typeof sampleMessages) =>
    messages.filter(m => m.ticketId === ticketId),
  ),
}));

const mockTriageResult = {
  ticketId: 'tk-001',
  suggestedPriority: 'high' as const,
  suggestedAssignee: 'Security Team',
  suggestedCategory: 'authentication',
  reasoning: 'Login issues indicate a potential security concern',
};

// Create a single shared mock provider that persists across getProvider() calls
const mockTriageTicket = vi.fn().mockResolvedValue(mockTriageResult);
const mockProvider = {
  name: 'mock-provider',
  triageTicket: mockTriageTicket,
};

vi.mock('../../providers/index.js', () => ({
  getProvider: vi.fn(() => mockProvider),
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
    createSpinner: vi.fn(() => {
      const obj = {
        start: vi.fn(() => obj),
        succeed: vi.fn(),
        fail: vi.fn(),
        stop: vi.fn(),
      };
      return obj;
    }),
  };
});

const { registerTriageCommand } = await import('../../commands/triage.js');
const outputMod = await import('../../output.js');

describe('triage command', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTriageCommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
    // Reset the shared mock between tests
    mockTriageTicket.mockClear();
    mockTriageTicket.mockResolvedValue(mockTriageResult);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
    // Restore mockTriageTicket after clearAllMocks may reset it
    mockTriageTicket.mockResolvedValue(mockTriageResult);
  });

  it('triages open tickets by default', async () => {
    await program.parseAsync(['node', 'cliaas', 'triage']);

    // 3 open tickets should be triaged
    expect(mockTriageTicket).toHaveBeenCalledTimes(3);
  });

  it('filters by queue status', async () => {
    await program.parseAsync(['node', 'cliaas', 'triage', '--queue', 'pending']);

    // Only 1 pending ticket
    expect(mockTriageTicket).toHaveBeenCalledTimes(1);
  });

  it('respects --limit', async () => {
    await program.parseAsync(['node', 'cliaas', 'triage', '--limit', '1']);

    expect(mockTriageTicket).toHaveBeenCalledTimes(1);
  });

  it('handles empty queue', async () => {
    await program.parseAsync(['node', 'cliaas', 'triage', '--queue', 'closed']);

    expect(mockTriageTicket).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('handles triage errors gracefully', async () => {
    mockTriageTicket.mockRejectedValueOnce(new Error('LLM rate limited'));

    await program.parseAsync(['node', 'cliaas', 'triage', '--limit', '1']);

    const spinner = (outputMod.createSpinner as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(spinner.fail).toHaveBeenCalled();
  });

  it('outputs structured JSON in json mode', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'triage', '--limit', '1']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('queue', 'open');
    expect(data).toHaveProperty('provider', 'mock-provider');
    expect(data.results[0]).toHaveProperty('suggestedPriority');
    expect(data.results[0]).toHaveProperty('suggestedCategory');
  });
});
