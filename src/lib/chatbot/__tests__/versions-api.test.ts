/**
 * Tests for chatbot version management (JSONL mode).
 * In JSONL mode, only publishChatbot works (bumps version on flow).
 * getChatbotVersions, rollbackChatbot, getChatbotVersion require DB and return empty/null.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { upsertChatbot, getChatbot, deleteChatbot } from '../store';
import { publishChatbot, rollbackChatbot, getChatbotVersions, getChatbotVersion } from '../versions';
import type { ChatbotFlow } from '../types';

function makeFlow(id: string, name = 'Test Bot'): ChatbotFlow {
  const rootId = `root-${id}`;
  return {
    id,
    name,
    nodes: {
      [rootId]: { id: rootId, type: 'message', data: { text: 'Hello' }, children: [] },
    },
    rootNodeId: rootId,
    enabled: false,
    version: 1,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('chatbot version management (JSONL mode)', () => {
  const testIds = ['ver-api-1', 'ver-api-2', 'ver-api-3', 'ver-api-4'];

  beforeEach(async () => {
    for (const id of testIds) {
      try { await deleteChatbot(id); } catch { /* ignore */ }
    }
  });

  it('publish returns null for nonexistent chatbot', async () => {
    const result = await publishChatbot('nonexistent-id-xyz');
    expect(result).toBeNull();
  });

  it('publish bumps version on flow', async () => {
    const flow = makeFlow('ver-api-1');
    flow.version = 0;
    await upsertChatbot(flow);

    const r1 = await publishChatbot('ver-api-1');
    expect(r1?.version).toBe(1);

    const updated = await getChatbot('ver-api-1');
    expect(updated?.version).toBe(1);
    expect(updated?.status).toBe('published');
  });

  it('publish increments version each call', async () => {
    const flow = makeFlow('ver-api-2');
    flow.version = 0;
    await upsertChatbot(flow);

    const r1 = await publishChatbot('ver-api-2');
    const r2 = await publishChatbot('ver-api-2');
    const r3 = await publishChatbot('ver-api-2');

    expect(r1?.version).toBe(1);
    expect(r2?.version).toBe(2);
    expect(r3?.version).toBe(3);
  });

  it('getChatbotVersions returns empty in JSONL mode', async () => {
    const flow = makeFlow('ver-api-3');
    await upsertChatbot(flow);
    await publishChatbot('ver-api-3');

    const versions = await getChatbotVersions('ver-api-3');
    expect(versions).toEqual([]);
  });

  it('getChatbotVersion returns null in JSONL mode', async () => {
    const result = await getChatbotVersion('ver-api-3', 1);
    expect(result).toBeNull();
  });

  it('rollback returns null in JSONL mode', async () => {
    const flow = makeFlow('ver-api-4');
    await upsertChatbot(flow);
    await publishChatbot('ver-api-4');

    const result = await rollbackChatbot('ver-api-4', 1);
    expect(result).toBeNull();
  });
});
