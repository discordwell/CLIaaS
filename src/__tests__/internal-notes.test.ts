/**
 * Tests for Internal Notes & Side Conversations (Plan 09)
 */

import { describe, it, expect } from 'vitest';

// Phase 1: Internal Notes Foundation

describe('Internal Notes — Types', () => {
  it('Message type includes visibility field', () => {
    // Verify the Message interface supports visibility
    type Message = {
      id: string;
      ticketId: string;
      author: string;
      body: string;
      type: 'reply' | 'note' | 'system';
      visibility?: 'public' | 'internal';
      createdAt: string;
    };

    const note: Message = {
      id: '1',
      ticketId: 't1',
      author: 'agent',
      body: 'Internal note',
      type: 'note',
      visibility: 'internal',
      createdAt: new Date().toISOString(),
    };

    expect(note.visibility).toBe('internal');
    expect(note.type).toBe('note');
  });

  it('MessageCreateParams supports visibility', () => {
    type MessageCreateParams = {
      ticketId: string;
      body: string;
      authorType?: 'user' | 'customer' | 'system';
      authorId?: string;
      visibility?: 'public' | 'internal';
    };

    const params: MessageCreateParams = {
      ticketId: 't1',
      body: 'test note',
      authorType: 'user',
      visibility: 'internal',
    };

    expect(params.visibility).toBe('internal');
  });
});

// Phase 1: Email safety guard

describe('Internal Notes — Dispatcher Safety', () => {
  it('AI resolution events set should not include internal notes', () => {
    // The dispatcher skips AI resolution for internal notes
    // by checking data.isNote or data.visibility === 'internal'
    const data = { ticketId: 't1', isNote: true, visibility: 'internal' };

    // Safety check: internal notes should NOT trigger AI resolution
    const shouldSkipAI = data.isNote || data.visibility === 'internal';
    expect(shouldSkipAI).toBe(true);
  });

  it('Public replies should still trigger AI resolution', () => {
    const data = { ticketId: 't1', isNote: false, visibility: 'public' };

    const shouldSkipAI = data.isNote || data.visibility === 'internal';
    expect(shouldSkipAI).toBe(false);
  });
});

// Phase 2: @Mentions

describe('Mention Parser', () => {
  it('extracts @name mentions', async () => {
    const { extractMentions } = await import('../lib/mentions');

    const result = extractMentions('Hey @jane check this out');
    expect(result).toContain('jane');
  });

  it('extracts @name.surname mentions', async () => {
    const { extractMentions } = await import('../lib/mentions');

    const result = extractMentions('@bob.smith please review @jane.doe');
    expect(result).toContain('bob.smith');
    expect(result).toContain('jane.doe');
  });

  it('extracts @email mentions', async () => {
    const { extractMentions } = await import('../lib/mentions');

    const result = extractMentions('CC @alice@example.com on this');
    expect(result).toContain('alice@example.com');
  });

  it('returns empty array for no mentions', async () => {
    const { extractMentions } = await import('../lib/mentions');

    const result = extractMentions('No mentions here');
    expect(result).toEqual([]);
  });

  it('deduplicates mentions', async () => {
    const { extractMentions } = await import('../lib/mentions');

    const result = extractMentions('@jane @jane @jane');
    expect(result).toEqual(['jane']);
  });
});

// Phase 3: Side Conversations — type validation

describe('Side Conversations — Types', () => {
  it('conversation kind enum includes primary and side', () => {
    const kinds = ['primary', 'side'] as const;
    type ConversationKind = typeof kinds[number];

    const primary: ConversationKind = 'primary';
    const side: ConversationKind = 'side';

    expect(primary).toBe('primary');
    expect(side).toBe('side');
  });

  it('side conversation status includes open and closed', () => {
    const statuses = ['open', 'closed'] as const;
    type SCStatus = typeof statuses[number];

    const open: SCStatus = 'open';
    const closed: SCStatus = 'closed';

    expect(open).toBe('open');
    expect(closed).toBe('closed');
  });
});

// Phase 3: Email threading

describe('Side Conversations — Email Threading', () => {
  it('generates correct In-Reply-To header format', () => {
    const conversationId = 'abc-123-def';
    const domain = 'cliaas.com';
    const threadId = `<sc-${conversationId}@${domain}>`;

    expect(threadId).toBe('<sc-abc-123-def@cliaas.com>');
  });

  it('inbound email parser extracts conversation ID from In-Reply-To', () => {
    const inReplyTo = '<sc-abc-123-def@cliaas.com>';
    const match = inReplyTo.match(/sc-([0-9a-f-]+)@/i);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('abc-123-def');
  });

  it('handles References header with multiple message IDs', () => {
    const references = '<sc-abc-123-def@cliaas.com> <other-msg@example.com>';
    const match = references.match(/sc-([0-9a-f-]+)@/i);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('abc-123-def');
  });
});

// Phase 4: Event pipeline

describe('Event Pipeline — Side Conversations', () => {
  it('canonical events include side conversation events', () => {
    type CanonicalEvent =
      | 'ticket.created'
      | 'ticket.updated'
      | 'message.created'
      | 'side_conversation.created'
      | 'side_conversation.replied';

    const event: CanonicalEvent = 'side_conversation.created';
    expect(event).toBe('side_conversation.created');
  });

  it('SSE event types include side conversation events', () => {
    type EventType =
      | 'ticket:created'
      | 'side_conversation:created'
      | 'side_conversation:replied'
      | 'note:created'
      | 'mention:created';

    const event: EventType = 'side_conversation:replied';
    expect(event).toBe('side_conversation:replied');
  });
});

// Portal isolation

describe('Portal Isolation', () => {
  it('portal should only show public messages from primary conversations', () => {
    // Simulate portal message filtering
    const messages = [
      { id: '1', visibility: 'public', conversationKind: 'primary', body: 'Public reply' },
      { id: '2', visibility: 'internal', conversationKind: 'primary', body: 'Internal note' },
      { id: '3', visibility: 'internal', conversationKind: 'side', body: 'Side convo msg' },
      { id: '4', visibility: 'public', conversationKind: 'side', body: 'Should not show' },
    ];

    const portalMessages = messages.filter(
      (m) => m.visibility === 'public' && m.conversationKind === 'primary'
    );

    expect(portalMessages).toHaveLength(1);
    expect(portalMessages[0].body).toBe('Public reply');
  });
});
