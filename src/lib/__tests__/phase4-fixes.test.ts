import { describe, it, expect, beforeEach } from 'vitest';
import { generateToken, cleanupExpiredTokens } from '@/lib/portal/magic-link';
import { recordResolution, getROIMetrics, resetROIMetrics } from '@/lib/ai/roi-tracker';
import {
  enqueueApproval,
  approveEntry,
  rejectEntry,
  editEntry,
  type ApprovalEntry,
} from '@/lib/ai/approval-queue';
import type { AIAgentResult } from '@/lib/ai/agent';

// ---- Magic link cleanup ----

describe('magic-link cleanup on generate', () => {
  beforeEach(() => {
    global.__cliaasPortalTokens = undefined;
  });

  it('cleans up expired tokens when generating a new one', () => {
    // Create a token with expired timestamp
    const store = new Map();
    store.set('expired-token', {
      token: 'expired-token',
      email: 'old@test.com',
      createdAt: Date.now() - 20 * 60 * 1000,
      expiresAt: Date.now() - 5 * 60 * 1000, // expired 5 min ago
      used: false,
    });
    store.set('used-token', {
      token: 'used-token',
      email: 'used@test.com',
      createdAt: Date.now() - 10 * 60 * 1000,
      expiresAt: Date.now() + 5 * 60 * 1000, // not expired
      used: true,
    });
    global.__cliaasPortalTokens = store;

    // Generate new token — should trigger cleanup
    generateToken('new@test.com');

    // Expired and used tokens should be cleaned up
    expect(store.has('expired-token')).toBe(false);
    expect(store.has('used-token')).toBe(false);
    // New token should exist (store size = 1)
    expect(store.size).toBe(1);
  });
});

// ---- Approval queue transitionEntry ----

describe('approval queue transitionEntry', () => {
  beforeEach(() => {
    global.__cliaasApprovalQueue = [];
  });

  const entry: ApprovalEntry = {
    id: 'appr-1',
    ticketId: 'ticket-1',
    ticketSubject: 'Help',
    draftReply: 'Response',
    confidence: 0.9,
    reasoning: 'Match',
    kbArticlesUsed: [],
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  it('approveEntry transitions correctly', () => {
    enqueueApproval({ ...entry });
    const result = approveEntry('appr-1', 'agent');
    expect(result?.status).toBe('approved');
    expect(result?.reviewedBy).toBe('agent');
    expect(result?.reviewedAt).toBeTruthy();
  });

  it('rejectEntry transitions correctly', () => {
    enqueueApproval({ ...entry });
    const result = rejectEntry('appr-1', 'agent');
    expect(result?.status).toBe('rejected');
  });

  it('editEntry transitions correctly with editedReply', () => {
    enqueueApproval({ ...entry });
    const result = editEntry('appr-1', 'New reply', 'agent');
    expect(result?.status).toBe('edited');
    expect(result?.editedReply).toBe('New reply');
  });
});

// ---- ROI tracker ----

describe('ROI tracker with 0 resolutions', () => {
  beforeEach(() => {
    resetROIMetrics();
  });

  it('returns zeros when no resolutions recorded', () => {
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(0);
    expect(m.aiResolved).toBe(0);
    expect(m.avgConfidence).toBe(0);
    expect(m.resolutionRate).toBe(0);
    expect(m.avgCostPerResolution).toBe(0);
  });

  it('computes correctly with N resolutions', () => {
    const resolved: AIAgentResult = {
      ticketId: 't-1',
      resolved: true,
      confidence: 0.85,
      suggestedReply: 'Done',
      reasoning: 'Match',
      escalated: false,
      kbArticlesUsed: [],
    };
    recordResolution(resolved);
    recordResolution(resolved);
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(2);
    expect(m.aiResolved).toBe(2);
    expect(m.resolutionRate).toBe(100);
    expect(m.avgCostPerResolution).toBe(0.03);
    expect(m.avgConfidence).toBe(0.85);
  });
});
