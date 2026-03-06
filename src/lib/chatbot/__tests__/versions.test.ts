import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../store-helpers', () => ({
  tryDb: vi.fn().mockResolvedValue(null),
  getDefaultWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
}));

vi.mock('../../jsonl-store', () => {
  let store: unknown[] = [];
  return {
    readJsonlFile: vi.fn(() => store),
    writeJsonlFile: vi.fn((_file: string, data: unknown[]) => { store = data; }),
    __resetStore: () => { store = []; },
  };
});

import { publishChatbot, rollbackChatbot, getChatbotVersions, getChatbotVersion } from '../versions';
import { upsertChatbot, getChatbot } from '../store';
import type { ChatbotFlow } from '../types';
import { readJsonlFile } from '../../jsonl-store';

function makeFlow(overrides?: Partial<ChatbotFlow>): ChatbotFlow {
  return {
    id: 'flow-1',
    name: 'Test Bot',
    nodes: {
      'root': { id: 'root', type: 'message', data: { text: 'Hello' }, children: [] },
    },
    rootNodeId: 'root',
    enabled: true,
    version: 1,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('chatbot versions (JSONL mode)', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (readJsonlFile as any).__resetStore?.();
    // Reset the mock store
    const mod = vi.mocked(await import('../../jsonl-store'));
    mod.__resetStore?.();
  });

  it('publish bumps version in JSONL mode', async () => {
    const flow = makeFlow();
    await upsertChatbot(flow);

    const result = await publishChatbot('flow-1');
    expect(result).toEqual({ version: 2 });

    const updated = await getChatbot('flow-1');
    expect(updated?.version).toBe(2);
    expect(updated?.status).toBe('published');
  });

  it('publish returns null for non-existent flow', async () => {
    const result = await publishChatbot('non-existent');
    expect(result).toBeNull();
  });

  it('getChatbotVersions returns empty in JSONL mode', async () => {
    const versions = await getChatbotVersions('flow-1');
    expect(versions).toEqual([]);
  });

  it('getChatbotVersion returns null in JSONL mode', async () => {
    const version = await getChatbotVersion('flow-1', 1);
    expect(version).toBeNull();
  });

  it('rollbackChatbot returns null in JSONL mode', async () => {
    const result = await rollbackChatbot('flow-1', 1);
    expect(result).toBeNull();
  });

  it('publish preserves flow data', async () => {
    const flow = makeFlow({
      nodes: {
        'root': { id: 'root', type: 'message', data: { text: 'Hello World' }, children: ['btn1'] },
        'btn1': { id: 'btn1', type: 'buttons', data: { text: 'Choose:', options: [] } },
      },
    });
    await upsertChatbot(flow);

    await publishChatbot('flow-1');

    const updated = await getChatbot('flow-1');
    expect(Object.keys(updated!.nodes)).toHaveLength(2);
    expect(updated!.nodes['root'].data).toEqual({ text: 'Hello World' });
  });

  it('multiple publishes increment version', async () => {
    const flow = makeFlow();
    await upsertChatbot(flow);

    await publishChatbot('flow-1');
    await publishChatbot('flow-1');
    await publishChatbot('flow-1');

    const updated = await getChatbot('flow-1');
    expect(updated?.version).toBe(4);
  });

  it('store backward compat: flows without version/status get defaults', async () => {
    const flow = makeFlow();
    delete (flow as Record<string, unknown>).version;
    delete (flow as Record<string, unknown>).status;
    await upsertChatbot(flow);

    const loaded = await getChatbot('flow-1');
    expect(loaded?.version).toBeUndefined();
    // JSONL stores raw, no transformation
  });
});
