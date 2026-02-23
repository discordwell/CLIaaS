import { describe, it, expect, beforeEach } from 'vitest';
import {
  getApprovalQueue,
  enqueueApproval,
  getApproval,
  getPendingApprovals,
  approveEntry,
  rejectEntry,
  editEntry,
  type ApprovalEntry,
} from '../approval-queue';

const sampleEntry: ApprovalEntry = {
  id: 'appr-1',
  ticketId: 'ticket-1',
  ticketSubject: 'Help needed',
  draftReply: 'Here is a suggested response.',
  confidence: 0.85,
  reasoning: 'KB match found',
  kbArticlesUsed: ['kb-1'],
  status: 'pending',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  global.__cliaasApprovalQueue = [];
});

function freshEntry(): ApprovalEntry {
  return { ...sampleEntry };
}

describe('approval queue CRUD', () => {
  it('starts empty', () => {
    expect(getApprovalQueue()).toEqual([]);
  });

  it('enqueues and retrieves entries', () => {
    enqueueApproval(freshEntry());
    expect(getApprovalQueue()).toHaveLength(1);
    expect(getApproval('appr-1')?.ticketId).toBe('ticket-1');
  });

  it('getPendingApprovals filters by status', () => {
    enqueueApproval(freshEntry());
    enqueueApproval({ ...freshEntry(), id: 'appr-2' });
    expect(getPendingApprovals()).toHaveLength(2);

    approveEntry('appr-1', 'agent');
    expect(getPendingApprovals()).toHaveLength(1);
  });
});

describe('approve/reject/edit', () => {
  it('approves a pending entry', () => {
    enqueueApproval(freshEntry());
    const result = approveEntry('appr-1', 'agent-1');
    expect(result?.status).toBe('approved');
    expect(result?.reviewedBy).toBe('agent-1');
    expect(result?.reviewedAt).toBeTruthy();
  });

  it('rejects a pending entry', () => {
    enqueueApproval(freshEntry());
    const result = rejectEntry('appr-1', 'agent-1');
    expect(result?.status).toBe('rejected');
  });

  it('edits a pending entry', () => {
    enqueueApproval(freshEntry());
    const result = editEntry('appr-1', 'Revised reply text', 'agent-1');
    expect(result?.status).toBe('edited');
    expect(result?.editedReply).toBe('Revised reply text');
  });

  it('returns null for non-existent entry', () => {
    expect(approveEntry('nope', 'agent')).toBeNull();
  });

  it('returns null for already-processed entry', () => {
    enqueueApproval(freshEntry());
    approveEntry('appr-1', 'agent');
    expect(approveEntry('appr-1', 'agent')).toBeNull();
  });
});
