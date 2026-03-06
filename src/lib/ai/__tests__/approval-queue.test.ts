import { describe, it, expect, beforeEach } from 'vitest';
import {
  getApprovalQueue,
  getApproval,
  getPendingApprovals,
  approveEntry,
  rejectEntry,
  editEntry,
} from '../approval-queue';
import { saveResolution } from '../store';

beforeEach(() => {
  (globalThis as Record<string, unknown>).__cliaasAIResolutions = undefined;
  (globalThis as Record<string, unknown>).__cliaasAIAgentConfig = undefined;
});

async function seedEntry(id = 'appr-1') {
  await saveResolution({
    id,
    workspaceId: 'ws-1',
    ticketId: 'ticket-1',
    confidence: 0.85,
    suggestedReply: 'Here is a suggested response.',
    reasoning: 'KB match found',
    kbArticlesUsed: ['kb-1'],
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
}

describe('approval queue CRUD', () => {
  it('starts empty', async () => {
    expect(await getApprovalQueue()).toEqual([]);
  });

  it('enqueues and retrieves entries', async () => {
    await seedEntry();
    expect(await getApprovalQueue()).toHaveLength(1);
    const entry = await getApproval('appr-1');
    expect(entry?.ticketId).toBe('ticket-1');
  });

  it('getPendingApprovals filters by status', async () => {
    await seedEntry('appr-1');
    await seedEntry('appr-2');
    expect(await getPendingApprovals()).toHaveLength(2);

    await approveEntry('appr-1', 'agent');
    expect(await getPendingApprovals()).toHaveLength(1);
  });
});

describe('approve/reject/edit', () => {
  it('approves a pending entry', async () => {
    await seedEntry();
    const result = await approveEntry('appr-1', 'agent-1');
    expect(result?.status).toBe('approved');
    expect(result?.reviewedBy).toBe('agent-1');
    expect(result?.reviewedAt).toBeTruthy();
  });

  it('rejects a pending entry', async () => {
    await seedEntry();
    const result = await rejectEntry('appr-1', 'agent-1');
    expect(result?.status).toBe('rejected');
  });

  it('edits a pending entry', async () => {
    await seedEntry();
    const result = await editEntry('appr-1', 'Revised reply text', 'agent-1');
    expect(result?.status).toBe('edited');
    expect(result?.editedReply).toBe('Revised reply text');
  });

  it('returns null for non-existent entry', async () => {
    expect(await approveEntry('nope', 'agent')).toBeNull();
  });

  it('returns null for already-processed entry', async () => {
    await seedEntry();
    await rejectEntry('appr-1', 'agent');
    expect(await approveEntry('appr-1', 'agent')).toBeNull();
  });
});
