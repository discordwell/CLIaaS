import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies
vi.mock('../store', () => ({
  updateResolutionStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../realtime/events', () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock('../../data-provider/index', () => ({
  getDataProvider: vi.fn().mockResolvedValue({
    createMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    loadTickets: vi.fn().mockResolvedValue([{
      id: 'ticket-1',
      subject: 'Test ticket',
      status: 'open',
      requester: 'customer@test.com',
    }]),
    loadCustomers: vi.fn().mockResolvedValue([{
      name: 'customer@test.com',
      email: 'customer@test.com',
    }]),
    updateTicket: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../email/sender', () => ({
  sendTicketReply: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { sendAIReply } from '../reply-sender';
import type { AIResolutionRecord, AIAgentConfigRecord } from '../store';

const baseResolution: AIResolutionRecord = {
  id: 'res-1',
  workspaceId: 'ws-1',
  ticketId: 'ticket-1',
  confidence: 0.9,
  suggestedReply: 'Here is how to fix your issue...',
  kbArticlesUsed: [],
  status: 'pending',
  createdAt: new Date().toISOString(),
};

const baseConfig: AIAgentConfigRecord = {
  id: 'cfg-1',
  workspaceId: 'ws-1',
  enabled: true,
  mode: 'auto',
  confidenceThreshold: 0.7,
  provider: 'claude',
  maxTokens: 1024,
  excludedTopics: [],
  kbContext: true,
  piiDetection: true,
  maxAutoResolvesPerHour: 50,
  requireKbCitation: false,
  channels: [],
};

describe('sendAIReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends reply successfully', async () => {
    const result = await sendAIReply(baseResolution, baseConfig);
    expect(result.sent).toBe(true);
    expect(result.piiBlocked).toBe(false);
  });

  it('blocks send when PII is detected', async () => {
    const resolutionWithPII = {
      ...baseResolution,
      suggestedReply: 'Your SSN is 123-45-6789',
    };

    const result = await sendAIReply(resolutionWithPII, baseConfig);
    expect(result.sent).toBe(false);
    expect(result.piiBlocked).toBe(true);
  });

  it('skips PII check when disabled', async () => {
    const resolutionWithPII = {
      ...baseResolution,
      suggestedReply: 'Your SSN is 123-45-6789',
    };
    const configNoPII = { ...baseConfig, piiDetection: false };

    const result = await sendAIReply(resolutionWithPII, configNoPII);
    expect(result.sent).toBe(true);
    expect(result.piiBlocked).toBe(false);
  });
});
