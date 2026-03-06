import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BullMQ to avoid Redis requirement
vi.mock('bullmq', () => {
  const WorkerMock = vi.fn().mockImplementation(function(this: Record<string, unknown>, _name: string, processor: unknown) {
    this.processor = processor;
    this.on = vi.fn();
    this.close = vi.fn();
    return this;
  });
  return { Worker: WorkerMock };
});

vi.mock('../../connection', () => ({
  getRedisConnectionOpts: vi.fn().mockReturnValue({ connection: { host: 'localhost' } }),
}));

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../ai/store', () => ({
  getAgentConfig: vi.fn().mockResolvedValue({
    id: 'cfg-1',
    workspaceId: 'ws-1',
    enabled: true,
    mode: 'suggest',
    confidenceThreshold: 0.7,
    provider: 'claude',
    maxTokens: 1024,
    excludedTopics: [],
    kbContext: true,
    piiDetection: true,
    maxAutoResolvesPerHour: 50,
    requireKbCitation: false,
    channels: [],
  }),
  listResolutions: vi.fn().mockResolvedValue({ records: [], total: 0 }),
}));

vi.mock('../../../data-provider/index', () => ({
  getDataProvider: vi.fn().mockResolvedValue({
    loadTickets: vi.fn().mockResolvedValue([{
      id: 'ticket-1',
      subject: 'Help needed',
      status: 'open',
      priority: 'normal',
      requester: 'customer@test.com',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      externalId: 'ext-1',
      source: 'zendesk',
    }]),
    loadMessages: vi.fn().mockResolvedValue([]),
    loadKBArticles: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../../../ai/resolution-pipeline', () => ({
  resolveTicket: vi.fn().mockResolvedValue({
    ticketId: 'ticket-1',
    action: 'queued_for_approval',
    result: { confidence: 0.8, suggestedReply: 'Try this fix...' },
    resolutionId: 'res-1',
  }),
}));

import { createAIResolutionWorker } from '../ai-resolution-worker';
import { Worker } from 'bullmq';

describe('AI Resolution Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a worker when Redis is available', () => {
    const worker = createAIResolutionWorker();
    expect(worker).not.toBeNull();
    expect(Worker).toHaveBeenCalled();
  });

  it('processes a job and calls resolveTicket', async () => {
    createAIResolutionWorker();

    // Get the processor function that was passed to Worker constructor
    const processorFn = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

    const result = await processorFn({
      data: {
        ticketId: 'ticket-1',
        event: 'ticket.created',
        data: { workspaceId: 'ws-1' },
        requestedAt: new Date().toISOString(),
      },
    });

    expect(result.status).toBe('queued_for_approval');
    expect(result.resolutionId).toBe('res-1');
  });

  it('returns disabled when AI is not enabled', async () => {
    const { getAgentConfig } = await import('../../../ai/store');
    (getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enabled: false,
    });

    createAIResolutionWorker();
    const processorFn = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

    const result = await processorFn({
      data: {
        ticketId: 'ticket-1',
        event: 'ticket.created',
        data: { workspaceId: 'ws-1' },
        requestedAt: new Date().toISOString(),
      },
    });

    expect(result.status).toBe('disabled');
  });

  it('skips duplicate pending resolutions', async () => {
    const { listResolutions } = await import('../../../ai/store');
    (listResolutions as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      records: [{ id: 'existing-res', status: 'pending' }],
      total: 1,
    });

    createAIResolutionWorker();
    const processorFn = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

    const result = await processorFn({
      data: {
        ticketId: 'ticket-1',
        event: 'ticket.created',
        data: { workspaceId: 'ws-1' },
        requestedAt: new Date().toISOString(),
      },
    });

    expect(result.status).toBe('duplicate');
  });
});
