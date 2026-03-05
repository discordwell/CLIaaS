import { describe, it, expect, vi } from 'vitest';
import { getUpstreamAdapter } from '../../sync/upstream-adapters/index.js';

// Mock all connector modules to prevent real HTTP calls
vi.mock('../../connectors/zendesk.js', () => ({
  zendeskCreateTicket: vi.fn().mockResolvedValue({ id: 101 }),
  zendeskUpdateTicket: vi.fn().mockResolvedValue(undefined),
  zendeskPostComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/freshdesk.js', () => ({
  freshdeskCreateTicket: vi.fn().mockResolvedValue({ id: 201 }),
  freshdeskUpdateTicket: vi.fn().mockResolvedValue(undefined),
  freshdeskReply: vi.fn().mockResolvedValue(undefined),
  freshdeskAddNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/groove.js', () => ({
  grooveCreateTicket: vi.fn().mockResolvedValue({ number: 301 }),
  grooveUpdateTicket: vi.fn().mockResolvedValue(undefined),
  groovePostMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/helpcrunch.js', () => ({
  helpcrunchCreateChat: vi.fn().mockResolvedValue({ id: 401 }),
  helpcrunchUpdateChat: vi.fn().mockResolvedValue(undefined),
  helpcrunchPostMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/intercom.js', () => ({
  intercomCreateConversation: vi.fn().mockResolvedValue({ id: 'ic-501' }),
  intercomReplyToConversation: vi.fn().mockResolvedValue(undefined),
  intercomAddNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/helpscout.js', () => ({
  helpscoutCreateConversation: vi.fn().mockResolvedValue({ id: 601 }),
  helpscoutReply: vi.fn().mockResolvedValue(undefined),
  helpscoutAddNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/zoho-desk.js', () => ({
  zodeskCreateTicket: vi.fn().mockResolvedValue({ id: 'zd-701' }),
  zodeskSendReply: vi.fn().mockResolvedValue(undefined),
  zodeskAddComment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../connectors/hubspot.js', () => ({
  hubspotCreateTicket: vi.fn().mockResolvedValue({ id: 'hub-801' }),
  hubspotCreateNote: vi.fn().mockResolvedValue({ id: 'note-801' }),
}));

describe('getUpstreamAdapter factory', () => {
  it('returns null for unknown connector', () => {
    expect(getUpstreamAdapter('nonexistent', {})).toBeNull();
  });

  it('returns null for kayako', () => {
    expect(getUpstreamAdapter('kayako', {})).toBeNull();
  });

  it('returns null for kayako-classic', () => {
    expect(getUpstreamAdapter('kayako-classic', {})).toBeNull();
  });

  const connectors = ['zendesk', 'freshdesk', 'groove', 'helpcrunch', 'intercom', 'helpscout', 'zoho-desk', 'hubspot'];

  it.each(connectors)('returns an adapter for %s', (name) => {
    const adapter = getUpstreamAdapter(name, { token: 'test', subdomain: 'test', email: 'test', apiKey: 'test', appId: 'test', appSecret: 'test', domain: 'test', orgId: 'test' });
    expect(adapter).not.toBeNull();
    expect(adapter!.name).toBe(name);
  });
});

describe('Zendesk adapter', () => {
  const adapter = getUpstreamAdapter('zendesk', { subdomain: 'acme', email: 'a@b.com', token: 'tok' })!;

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('creates a ticket and returns externalId', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('101');
  });

  it('updates a ticket with status mapping', async () => {
    await adapter.updateTicket('99', { status: 'on_hold' });
    const { zendeskUpdateTicket } = await import('../../connectors/zendesk.js');
    expect(zendeskUpdateTicket).toHaveBeenCalledWith(
      { subdomain: 'acme', email: 'a@b.com', token: 'tok' },
      99,
      { status: 'hold' },
    );
  });

  it('posts a public reply', async () => {
    await adapter.postReply('99', { body: 'Reply text' });
    const { zendeskPostComment } = await import('../../connectors/zendesk.js');
    expect(zendeskPostComment).toHaveBeenCalledWith(
      { subdomain: 'acme', email: 'a@b.com', token: 'tok' },
      99,
      'Reply text',
      true,
    );
  });

  it('posts a private note', async () => {
    await adapter.postNote('99', { body: 'Internal note' });
    const { zendeskPostComment } = await import('../../connectors/zendesk.js');
    expect(zendeskPostComment).toHaveBeenCalledWith(
      { subdomain: 'acme', email: 'a@b.com', token: 'tok' },
      99,
      'Internal note',
      false,
    );
  });
});

describe('Freshdesk adapter', () => {
  const adapter = getUpstreamAdapter('freshdesk', { domain: 'myco', apiKey: 'fk' })!;

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('creates a ticket', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('201');
  });

  it('maps status to numeric codes on update', async () => {
    await adapter.updateTicket('50', { status: 'solved', priority: 'high' });
    const { freshdeskUpdateTicket } = await import('../../connectors/freshdesk.js');
    expect(freshdeskUpdateTicket).toHaveBeenCalledWith(
      { subdomain: 'myco', apiKey: 'fk' },
      50,
      { status: 4, priority: 3 },
    );
  });
});

describe('Groove adapter', () => {
  const adapter = getUpstreamAdapter('groove', { apiKey: 'gv' })!;

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('creates a ticket and returns ticketNumber as externalId', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('301');
  });

  it('posts a note via groovePostMessage with isNote=true', async () => {
    await adapter.postNote('10', { body: 'Note text' });
    const { groovePostMessage } = await import('../../connectors/groove.js');
    expect(groovePostMessage).toHaveBeenCalledWith(
      { apiToken: 'gv' },
      10,
      'Note text',
      true,
    );
  });
});

describe('Intercom adapter', () => {
  const adapter = getUpstreamAdapter('intercom', { token: 'ic-tok' })!;

  it('does NOT support update', () => {
    expect(adapter.supportsUpdate).toBe(false);
    expect(adapter.supportsReply).toBe(true);
  });

  it('throws on updateTicket', async () => {
    await expect(adapter.updateTicket('1', {})).rejects.toThrow('does not support');
  });

  it('throws on postReply without INTERCOM_ADMIN_ID', async () => {
    delete process.env.INTERCOM_ADMIN_ID;
    // Need a fresh adapter for the env change
    const fresh = getUpstreamAdapter('intercom', { token: 'ic-tok' })!;
    await expect(fresh.postReply('1', { body: 'hi' })).rejects.toThrow('INTERCOM_ADMIN_ID');
  });
});

describe('HelpScout adapter', () => {
  const adapter = getUpstreamAdapter('helpscout', { appId: 'hs-id', appSecret: 'hs-sec' })!;

  it('does NOT support update', () => {
    expect(adapter.supportsUpdate).toBe(false);
    expect(adapter.supportsReply).toBe(true);
  });

  it('throws on updateTicket', async () => {
    await expect(adapter.updateTicket('1', {})).rejects.toThrow('does not support');
  });

  it('posts a reply', async () => {
    await adapter.postReply('42', { body: 'Reply' });
    const { helpscoutReply } = await import('../../connectors/helpscout.js');
    expect(helpscoutReply).toHaveBeenCalledWith(
      { appId: 'hs-id', appSecret: 'hs-sec' },
      42,
      'Reply',
    );
  });
});

describe('Zoho Desk adapter', () => {
  const adapter = getUpstreamAdapter('zoho-desk', { domain: 'desk.zoho.com', orgId: 'org-1', token: 'zt' })!;

  it('does NOT support update', () => {
    expect(adapter.supportsUpdate).toBe(false);
    expect(adapter.supportsReply).toBe(true);
  });

  it('creates a ticket', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('zd-701');
  });
});

describe('HubSpot adapter', () => {
  const adapter = getUpstreamAdapter('hubspot', { token: 'hub-tok' })!;

  it('supports neither update nor reply', () => {
    expect(adapter.supportsUpdate).toBe(false);
    expect(adapter.supportsReply).toBe(false);
  });

  it('throws on updateTicket', async () => {
    await expect(adapter.updateTicket('1', {})).rejects.toThrow('does not support');
  });

  it('throws on postReply', async () => {
    await expect(adapter.postReply('1', { body: 'hi' })).rejects.toThrow('does not support');
  });

  it('posts a note', async () => {
    await adapter.postNote('hub-99', { body: 'Note' });
    const { hubspotCreateNote } = await import('../../connectors/hubspot.js');
    expect(hubspotCreateNote).toHaveBeenCalledWith(
      { accessToken: 'hub-tok' },
      'hub-99',
      'Note',
    );
  });

  it('creates a ticket', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('hub-801');
  });
});
