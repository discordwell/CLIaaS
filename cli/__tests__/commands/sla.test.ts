import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { makeTicket, makeMessage } from './_fixtures.js';

// Create tickets with controlled dates to test SLA logic
const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600000).toISOString();

const slaTickets = [
  makeTicket({
    id: 'sla-001', externalId: '2001', subject: 'Urgent: system down',
    status: 'open', priority: 'urgent', assignee: 'Alice',
    createdAt: hoursAgo(5), updatedAt: hoursAgo(1),
  }),
  makeTicket({
    id: 'sla-002', externalId: '2002', subject: 'High: payment failing',
    status: 'open', priority: 'high', assignee: 'Bob',
    createdAt: hoursAgo(3), updatedAt: hoursAgo(1),
  }),
  makeTicket({
    id: 'sla-003', externalId: '2003', subject: 'Normal: question about features',
    status: 'pending', priority: 'normal', assignee: 'Charlie',
    createdAt: hoursAgo(2), updatedAt: hoursAgo(1),
  }),
];

const slaMessages = [
  makeMessage({
    id: 'sla-msg-001', ticketId: 'sla-001',
    author: 'customer@test.com', body: 'System is completely down!',
    type: 'reply', createdAt: hoursAgo(5),
  }),
  makeMessage({
    id: 'sla-msg-002a', ticketId: 'sla-002',
    author: 'customer2@test.com', body: 'Payment keeps failing',
    type: 'reply', createdAt: hoursAgo(3),
  }),
  makeMessage({
    id: 'sla-msg-002b', ticketId: 'sla-002',
    author: 'Bob', body: 'Let me check your account',
    type: 'reply', createdAt: hoursAgo(1),
  }),
  makeMessage({
    id: 'sla-msg-003a', ticketId: 'sla-003',
    author: 'customer3@test.com', body: 'Can you explain feature X?',
    type: 'reply', createdAt: hoursAgo(2),
  }),
  makeMessage({
    id: 'sla-msg-003b', ticketId: 'sla-003',
    author: 'Charlie', body: 'Feature X lets you...',
    type: 'reply', createdAt: hoursAgo(1.5),
  }),
];

vi.mock('../../data.js', () => ({
  loadTickets: vi.fn(() => slaTickets),
  loadMessages: vi.fn(() => slaMessages),
  getTicketMessages: vi.fn((ticketId: string, messages: typeof slaMessages) =>
    messages.filter(m => m.ticketId === ticketId),
  ),
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

const { registerSLACommand } = await import('../../commands/sla.js');
const outputMod = await import('../../output.js');

describe('sla command', () => {
  let program: Command;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSLACommand(program);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    (outputMod.setJsonMode as (b: boolean) => void)(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('produces an SLA compliance report with correct summary', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla']);

    expect(outputMod.output).toHaveBeenCalledTimes(1);
    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(data.summary.total).toBe(3);
    expect(data.summary.breached).toBeGreaterThanOrEqual(1);
  });

  it('includes SLA policies in output', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.policies).toHaveLength(4);
    expect(data.policies[0].priority).toBe('urgent');
    expect(data.policies[0].firstResponseHrs).toBe(1);
  });

  it('classifies breached tickets correctly', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];

    const ticket001 = data.tickets.find((t: { ticketId: string }) => t.ticketId === 'sla-001');
    expect(ticket001.firstResponseStatus).toBe('breached');
    expect(ticket001.resolutionStatus).toBe('breached');
  });

  it('classifies compliant tickets correctly', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];

    const ticket003 = data.tickets.find((t: { ticketId: string }) => t.ticketId === 'sla-003');
    expect(ticket003.firstResponseStatus).toBe('ok');
    expect(ticket003.resolutionStatus).toBe('ok');
  });

  it('filters by custom status', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla', '--status', 'pending']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data.summary.total).toBe(1);
    expect(data.tickets[0].ticketId).toBe('sla-003');
  });

  it('handles empty ticket set', async () => {
    await program.parseAsync(['node', 'cliaas', 'sla', '--status', 'closed']);

    expect(logSpy).toHaveBeenCalled();
  });

  it('outputs structured JSON', async () => {
    (outputMod.setJsonMode as (b: boolean) => void)(true);

    await program.parseAsync(['node', 'cliaas', 'sla']);

    const [data] = (outputMod.output as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('policies');
    expect(data).toHaveProperty('tickets');
    expect(data.tickets[0]).toHaveProperty('firstResponseStatus');
    expect(data.tickets[0]).toHaveProperty('resolutionStatus');
    expect(data.tickets[0]).toHaveProperty('slaTargetFirstResponseHrs');
  });
});
