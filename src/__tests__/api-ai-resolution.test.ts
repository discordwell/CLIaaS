import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveResolution,
  getResolution,
  listResolutions,
  type AIResolutionRecord,
} from '@/lib/ai/store';
import { approveEntry, rejectEntry } from '@/lib/ai/approval-queue';

// In-memory mode tests (no DB)

beforeEach(() => {
  global.__cliaasAIResolutions = undefined;
  global.__cliaasAIAgentConfig = undefined;
});

const mockResolution: AIResolutionRecord = {
  id: 'res-api-1',
  workspaceId: 'ws-1',
  ticketId: 'ticket-1',
  confidence: 0.9,
  suggestedReply: 'Here is the answer to your question.',
  kbArticlesUsed: ['kb-1'],
  status: 'pending',
  createdAt: new Date().toISOString(),
};

describe('AI Resolution API flow', () => {
  it('creates resolution, lists it, and gets by ID', async () => {
    await saveResolution(mockResolution);

    const { records, total } = await listResolutions({ workspaceId: 'ws-1' });
    expect(total).toBe(1);
    expect(records[0].id).toBe('res-api-1');

    const single = await getResolution('res-api-1');
    expect(single).not.toBeNull();
    expect(single!.status).toBe('pending');
  });

  it('reject flow: does not send reply', async () => {
    await saveResolution(mockResolution);

    const result = await rejectEntry('res-api-1', 'admin-1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('rejected');

    // Verify the stored record is updated
    const record = await getResolution('res-api-1');
    expect(record!.status).toBe('rejected');
    expect(record!.reviewedBy).toBe('admin-1');
  });

  it('returns null when approving non-existent resolution', async () => {
    const result = await approveEntry('nonexistent', 'admin-1');
    expect(result).toBeNull();
  });

  it('returns null when rejecting already-rejected resolution', async () => {
    await saveResolution(mockResolution);
    await rejectEntry('res-api-1', 'admin-1');
    const result = await rejectEntry('res-api-1', 'admin-2');
    expect(result).toBeNull();
  });

  it('filters resolutions by status', async () => {
    await saveResolution(mockResolution);
    await saveResolution({ ...mockResolution, id: 'res-api-2', status: 'escalated' });
    await saveResolution({ ...mockResolution, id: 'res-api-3', status: 'auto_resolved' });

    const { records: pending } = await listResolutions({ status: 'pending' });
    expect(pending).toHaveLength(1);

    const { records: escalated } = await listResolutions({ status: 'escalated' });
    expect(escalated).toHaveLength(1);

    const { records: all } = await listResolutions();
    expect(all).toHaveLength(3);
  });
});
