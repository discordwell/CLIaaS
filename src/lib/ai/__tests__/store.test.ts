import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveResolution,
  getResolution,
  listResolutions,
  updateResolutionStatus,
  getAgentConfig,
  saveAgentConfig,
  type AIResolutionRecord,
} from '../store';

// These tests use in-memory fallback (no DB)

beforeEach(() => {
  // Reset in-memory stores
  global.__cliaasAIResolutions = undefined;
  global.__cliaasAIAgentConfig = undefined;
});

describe('AI Resolution Store', () => {
  const mockResolution: AIResolutionRecord = {
    id: 'res-1',
    workspaceId: 'ws-1',
    ticketId: 'ticket-1',
    confidence: 0.85,
    suggestedReply: 'Try restarting the service.',
    reasoning: 'KB article matches the issue',
    kbArticlesUsed: ['kb-1'],
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  describe('saveResolution / getResolution', () => {
    it('saves and retrieves a resolution', async () => {
      await saveResolution(mockResolution);
      const retrieved = await getResolution('res-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('res-1');
      expect(retrieved!.confidence).toBe(0.85);
    });

    it('returns null for unknown ID', async () => {
      const result = await getResolution('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listResolutions', () => {
    it('lists all resolutions', async () => {
      await saveResolution(mockResolution);
      await saveResolution({ ...mockResolution, id: 'res-2', ticketId: 'ticket-2' });

      const { records, total } = await listResolutions();
      expect(total).toBe(2);
      expect(records).toHaveLength(2);
    });

    it('filters by status', async () => {
      await saveResolution(mockResolution);
      await saveResolution({ ...mockResolution, id: 'res-2', status: 'approved' });

      const { records } = await listResolutions({ status: 'pending' });
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('res-1');
    });

    it('filters by ticketId', async () => {
      await saveResolution(mockResolution);
      await saveResolution({ ...mockResolution, id: 'res-2', ticketId: 'ticket-2' });

      const { records } = await listResolutions({ ticketId: 'ticket-1' });
      expect(records).toHaveLength(1);
    });

    it('paginates with limit/offset', async () => {
      for (let i = 0; i < 5; i++) {
        await saveResolution({ ...mockResolution, id: `res-${i}` });
      }

      const { records } = await listResolutions({ limit: 2, offset: 1 });
      expect(records).toHaveLength(2);
    });
  });

  describe('updateResolutionStatus', () => {
    it('updates status', async () => {
      await saveResolution(mockResolution);
      const updated = await updateResolutionStatus('res-1', 'approved', {
        reviewedBy: 'agent-1',
        reviewedAt: new Date().toISOString(),
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
      expect(updated!.reviewedBy).toBe('agent-1');
    });

    it('returns null for unknown ID', async () => {
      const result = await updateResolutionStatus('nonexistent', 'approved');
      expect(result).toBeNull();
    });

    it('updates CSAT fields', async () => {
      await saveResolution({ ...mockResolution, status: 'auto_resolved' });
      const updated = await updateResolutionStatus('res-1', 'auto_resolved', {
        csatScore: 5,
        csatComment: 'Great help!',
      });

      expect(updated!.csatScore).toBe(5);
      expect(updated!.csatComment).toBe('Great help!');
    });
  });
});

describe('AI Agent Config Store', () => {
  it('returns default config for unknown workspace', async () => {
    const config = await getAgentConfig('ws-unknown');
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('suggest');
    expect(config.confidenceThreshold).toBe(0.7);
  });

  it('saves and retrieves config', async () => {
    await saveAgentConfig({
      workspaceId: 'ws-1',
      enabled: true,
      mode: 'auto',
      confidenceThreshold: 0.8,
    });

    const config = await getAgentConfig('ws-1');
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('auto');
    expect(config.confidenceThreshold).toBe(0.8);
  });

  it('merges partial updates', async () => {
    await saveAgentConfig({
      workspaceId: 'ws-1',
      enabled: true,
    });
    await saveAgentConfig({
      workspaceId: 'ws-1',
      mode: 'approve',
    });

    const config = await getAgentConfig('ws-1');
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('approve');
  });
});
