import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeSampleTickets, makeSampleMessages } from './_fixtures.js';

// Mock data module
const sampleTickets = makeSampleTickets();
const sampleMessages = makeSampleMessages();

vi.mock('../../data.js', () => ({
  loadTickets: vi.fn(() => sampleTickets),
  loadMessages: vi.fn(() => sampleMessages),
  getTicketMessages: vi.fn((ticketId: string, messages: typeof sampleMessages) =>
    messages.filter(m => m.ticketId === ticketId),
  ),
}));

// Mock output module -- capture calls
vi.mock('../../output.js', async () => {
  let _jsonMode = false;
  return {
    setJsonMode: (enabled: boolean) => { _jsonMode = enabled; },
    isJsonMode: () => _jsonMode,
    output: vi.fn((data: unknown, humanFn: (d: unknown) => void) => {
      if (_jsonMode) {
        // In tests, just store the data
      } else {
        humanFn(data);
      }
    }),
    outputError: vi.fn((msg: string) => {
      console.error(msg);
    }),
    info: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    })),
  };
});

const { registerTicketCommands } = await import('../../commands/tickets.js');
const outputMod = await import('../../output.js');

describe('tickets list', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTicketCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('lists all tickets in human mode', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets).toHaveLength(5);
    expect(data.total).toBe(5);
    expect(data.showing).toBe(5);
  });

  it('filters by status', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--status', 'open']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets.every((t: { status: string }) => t.status === 'open')).toBe(true);
    expect(data.tickets.length).toBe(3);
  });

  it('filters by priority', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--priority', 'high']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets.every((t: { priority: string }) => t.priority === 'high')).toBe(true);
    expect(data.tickets.length).toBe(2);
  });

  it('filters by assignee (case-insensitive)', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--assignee', 'alice']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets.every((t: { assignee: string }) => t.assignee?.toLowerCase().includes('alice'))).toBe(true);
    expect(data.tickets.length).toBe(2);
  });

  it('filters by tag', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--tag', 'billing']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets.length).toBe(1);
    expect(data.tickets[0].subject).toBe('Billing issue');
  });

  it('respects --limit', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--limit', '2']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets.length).toBe(2);
    expect(data.total).toBe(5);
    expect(data.showing).toBe(2);
  });

  it('handles empty results', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--status', 'closed']);

    // No output call (empty result goes through console.log in human mode)
    expect(logSpy).toHaveBeenCalled();
  });

  it('outputs structured JSON when --json flag is active', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'tickets', 'list']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('tickets');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('showing');
    expect(data.tickets[0]).toHaveProperty('id');
    expect(data.tickets[0]).toHaveProperty('externalId');
    expect(data.tickets[0]).toHaveProperty('status');
    expect(data.tickets[0]).toHaveProperty('priority');
    expect(data.tickets[0]).toHaveProperty('subject');
  });

  it('outputs structured JSON for empty results when --json is active', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'tickets', 'list', '--status', 'closed']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.tickets).toEqual([]);
    expect(data.total).toBe(0);
  });
});

describe('tickets search', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTicketCommands(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('finds tickets matching subject', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'search', 'login']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.query).toBe('login');
  });

  it('finds tickets matching tags', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'search', 'billing']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.ticketMatches).toBeGreaterThanOrEqual(1);
  });

  it('finds tickets by message content', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'search', 'subscription']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results.some((r: { id: string }) => r.id === 'tk-002')).toBe(true);
  });

  it('returns empty results for non-matching query', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'search', 'xyznonexistent']);

    expect(logSpy).toHaveBeenCalled();
  });

  it('outputs JSON for search results', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'tickets', 'search', 'login']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('query');
    expect(data).toHaveProperty('ticketMatches');
    expect(data).toHaveProperty('messageMatches');
  });
});

describe('tickets show', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerTicketCommands(program);
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

  it('shows ticket details by internal ID', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'show', 'tk-001']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.ticket.id).toBe('tk-001');
    expect(data.ticket.subject).toBe('Login not working');
    expect(data.messages.length).toBe(2);
  });

  it('shows ticket details by external ID', async () => {
    await program.parseAsync(['node', 'cliaas', 'tickets', 'show', '1002']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.ticket.id).toBe('tk-002');
    expect(data.ticket.subject).toBe('Billing issue');
  });

  it('exits with error for unknown ticket', async () => {
    await expect(
      program.parseAsync(['node', 'cliaas', 'tickets', 'show', 'nonexistent']),
    ).rejects.toThrow('process.exit');

    expect(outputMod.outputError).toHaveBeenCalled();
  });

  it('outputs JSON for ticket show', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'tickets', 'show', 'tk-001']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('ticket');
    expect(data).toHaveProperty('messages');
    expect(data.ticket.id).toBe('tk-001');
    expect(data.messages).toHaveLength(2);
  });
});
