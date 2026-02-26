import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatbotFlow } from '../types';

// Mock JSONL store before importing the module
const mockRead = vi.fn<() => ChatbotFlow[]>().mockReturnValue([]);
const mockWrite = vi.fn();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (...args: unknown[]) => mockRead(...(args as [])),
  writeJsonlFile: (...args: unknown[]) => mockWrite(...(args as [])),
}));

// Mock DB as unavailable (JSONL path)
vi.mock('@/db', () => ({
  getDb: () => null,
}));

const { getChatbots, getChatbot, upsertChatbot, deleteChatbot, getActiveChatbot } = await import('../store');

function makeFlow(overrides: Partial<ChatbotFlow> = {}): ChatbotFlow {
  return {
    id: 'flow-1',
    name: 'Test Flow',
    nodes: {
      root: { id: 'root', type: 'message', data: { text: 'Hi' } },
    },
    rootNodeId: 'root',
    enabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockReturnValue([]);
});

describe('getChatbots', () => {
  it('returns all flows from JSONL', async () => {
    const flows = [makeFlow(), makeFlow({ id: 'flow-2', name: 'Second' })];
    mockRead.mockReturnValue(flows);

    const result = await getChatbots();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Test Flow');
  });

  it('returns empty array when no flows', async () => {
    const result = await getChatbots();
    expect(result).toEqual([]);
  });
});

describe('getChatbot', () => {
  it('finds a flow by ID', async () => {
    mockRead.mockReturnValue([makeFlow()]);

    const result = await getChatbot('flow-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('flow-1');
  });

  it('returns null for unknown ID', async () => {
    const result = await getChatbot('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getActiveChatbot', () => {
  it('returns the first enabled flow', async () => {
    mockRead.mockReturnValue([
      makeFlow({ id: 'f1', enabled: false }),
      makeFlow({ id: 'f2', enabled: true, name: 'Active' }),
    ]);

    const result = await getActiveChatbot();
    expect(result).not.toBeNull();
    expect(result!.id).toBe('f2');
  });

  it('returns null when no flows are enabled', async () => {
    mockRead.mockReturnValue([makeFlow({ enabled: false })]);

    const result = await getActiveChatbot();
    expect(result).toBeNull();
  });
});

describe('upsertChatbot', () => {
  it('adds a new flow', async () => {
    const flow = makeFlow();
    await upsertChatbot(flow);

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const written = mockWrite.mock.calls[0][1] as ChatbotFlow[];
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('flow-1');
  });

  it('updates an existing flow by ID', async () => {
    mockRead.mockReturnValue([makeFlow()]);

    const updated = makeFlow({ name: 'Updated Name' });
    await upsertChatbot(updated);

    const written = mockWrite.mock.calls[0][1] as ChatbotFlow[];
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe('Updated Name');
  });
});

describe('deleteChatbot', () => {
  it('removes a flow by ID', async () => {
    mockRead.mockReturnValue([makeFlow(), makeFlow({ id: 'flow-2' })]);

    const result = await deleteChatbot('flow-1');
    expect(result).toBe(true);

    const written = mockWrite.mock.calls[0][1] as ChatbotFlow[];
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('flow-2');
  });

  it('returns false for unknown ID', async () => {
    const result = await deleteChatbot('nonexistent');
    expect(result).toBe(false);
  });
});
