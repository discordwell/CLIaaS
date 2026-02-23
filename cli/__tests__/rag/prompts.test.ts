import { describe, it, expect } from 'vitest';
import { buildRagReplyPrompt, buildRagAskPrompt } from '../../providers/base.js';
import type { Ticket, Message } from '../../schema/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    externalId: 'ext-1',
    source: 'zendesk',
    subject: 'Cannot reset password',
    status: 'open',
    priority: 'high',
    requester: 'customer@example.com',
    tags: ['auth', 'password'],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
    ...overrides,
  };
}

function makeMessages(count = 2): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    ticketId: 'ticket-1',
    author: i % 2 === 0 ? 'customer@example.com' : 'agent@support.com',
    body: i % 2 === 0
      ? `Customer message ${i}: I need help with my password.`
      : `Agent response ${i}: Let me help you with that.`,
    type: 'reply' as const,
    createdAt: new Date(Date.now() + i * 60_000).toISOString(),
  }));
}

const sampleContext = `## Retrieved Context

### Source 1: Password Reset Guide [score: 15.2]
Type: kb_article

[KB Article: Password Reset Guide]

To reset your password, go to Settings > Security > Change Password.

---

### Source 2: Authentication FAQ [score: 12.1]
Type: kb_article

[KB Article: Authentication FAQ]

Common auth issues include expired sessions and locked accounts.`;

// ── buildRagReplyPrompt ──────────────────────────────────────────────────────

describe('buildRagReplyPrompt', () => {
  it('includes ticket context', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext);

    expect(prompt).toContain('Cannot reset password');
    expect(prompt).toContain('customer@example.com');
  });

  it('includes RAG context', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext);

    expect(prompt).toContain('Password Reset Guide');
    expect(prompt).toContain('Authentication FAQ');
    expect(prompt).toContain('Retrieved Context');
  });

  it('includes citation instructions', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext);

    expect(prompt.toLowerCase()).toContain('cite');
  });

  it('includes tone instruction', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext, {
      tone: 'friendly',
    });

    expect(prompt).toContain('friendly');
  });

  it('defaults to professional tone', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext);

    expect(prompt).toContain('professional');
  });

  it('includes conversation thread', () => {
    const messages = makeMessages(4);
    const prompt = buildRagReplyPrompt(makeTicket(), messages, sampleContext);

    expect(prompt).toContain('Customer message');
    expect(prompt).toContain('Agent response');
  });

  it('instructs to write reply text only', () => {
    const prompt = buildRagReplyPrompt(makeTicket(), makeMessages(), sampleContext);

    expect(prompt.toLowerCase()).toContain('reply');
  });
});

// ── buildRagAskPrompt ────────────────────────────────────────────────────────

describe('buildRagAskPrompt', () => {
  it('includes the question', () => {
    const prompt = buildRagAskPrompt('How do I reset a password?', sampleContext);

    expect(prompt).toContain('How do I reset a password?');
  });

  it('includes the context', () => {
    const prompt = buildRagAskPrompt('Test question', sampleContext);

    expect(prompt).toContain('Password Reset Guide');
    expect(prompt).toContain('Authentication FAQ');
  });

  it('instructs to use only provided context', () => {
    const prompt = buildRagAskPrompt('Test', sampleContext);

    expect(prompt).toContain('ONLY');
    expect(prompt.toLowerCase()).toContain('context');
  });

  it('instructs to cite sources', () => {
    const prompt = buildRagAskPrompt('Test', sampleContext);

    expect(prompt.toLowerCase()).toContain('cite');
    expect(prompt.toLowerCase()).toContain('source');
  });

  it('handles empty context gracefully', () => {
    const prompt = buildRagAskPrompt('Test question', '');

    expect(prompt).toContain('Test question');
    // Should still produce a valid prompt even with empty context
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('preserves context formatting', () => {
    const prompt = buildRagAskPrompt('Question', sampleContext);

    // Context should be embedded verbatim
    expect(prompt).toContain('### Source 1:');
    expect(prompt).toContain('### Source 2:');
    expect(prompt).toContain('---');
  });
});
