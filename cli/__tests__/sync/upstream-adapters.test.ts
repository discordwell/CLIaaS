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
  helpcrunchSearchCustomers: vi.fn().mockResolvedValue([{ id: 42, name: 'Test', email: 'test@example.com' }]),
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
  hubspotUpdateTicket: vi.fn().mockResolvedValue(undefined),
  hubspotPostReply: vi.fn().mockResolvedValue({ id: 'email-801' }),
}));

vi.mock('../../connectors/kayako.js', () => ({
  kayakoUpdateCase: vi.fn().mockResolvedValue(undefined),
  kayakoPostReply: vi.fn().mockResolvedValue(undefined),
  kayakoPostNote: vi.fn().mockResolvedValue(undefined),
  kayakoCreateCase: vi.fn().mockResolvedValue({ id: 901 }),
}));

vi.mock('../../connectors/kayako-classic.js', () => ({
  kayakoClassicUpdateTicket: vi.fn().mockResolvedValue(undefined),
  kayakoClassicPostReply: vi.fn().mockResolvedValue(undefined),
  kayakoClassicPostNote: vi.fn().mockResolvedValue(undefined),
  kayakoClassicCreateTicket: vi.fn().mockResolvedValue({ id: 1001, displayId: 'KYC-1001' }),
}));

describe('getUpstreamAdapter factory', () => {
  it('returns null for unknown connector', () => {
    expect(getUpstreamAdapter('nonexistent', {})).toBeNull();
  });

  const connectors = ['zendesk', 'freshdesk', 'groove', 'helpcrunch', 'intercom', 'helpscout', 'zoho-desk', 'hubspot', 'kayako', 'kayako-classic'];

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

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('updates a ticket', async () => {
    await adapter.updateTicket('hub-99', { status: 'open', priority: 'high' });
    const { hubspotUpdateTicket } = await import('../../connectors/hubspot.js');
    expect(hubspotUpdateTicket).toHaveBeenCalledWith(
      { accessToken: 'hub-tok' },
      'hub-99',
      { status: 'open', priority: 'high' },
    );
  });

  it('posts a reply', async () => {
    await adapter.postReply('hub-99', { body: 'Reply text' });
    const { hubspotPostReply } = await import('../../connectors/hubspot.js');
    expect(hubspotPostReply).toHaveBeenCalledWith(
      { accessToken: 'hub-tok' },
      'hub-99',
      'Reply text',
    );
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

describe('Kayako adapter', () => {
  const adapter = getUpstreamAdapter('kayako', { domain: 'acme.kayako.com', email: 'a@b.com', password: 'pass' })!;

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('updates a case', async () => {
    await adapter.updateTicket('42', { status: 'open' });
    const { kayakoUpdateCase } = await import('../../connectors/kayako.js');
    expect(kayakoUpdateCase).toHaveBeenCalledWith(
      { domain: 'acme.kayako.com', email: 'a@b.com', password: 'pass' },
      42,
      { status: 'open' },
    );
  });

  it('posts a reply', async () => {
    await adapter.postReply('42', { body: 'Reply' });
    const { kayakoPostReply } = await import('../../connectors/kayako.js');
    expect(kayakoPostReply).toHaveBeenCalledWith(
      { domain: 'acme.kayako.com', email: 'a@b.com', password: 'pass' },
      42,
      'Reply',
    );
  });

  it('posts a note', async () => {
    await adapter.postNote('42', { body: 'Note' });
    const { kayakoPostNote } = await import('../../connectors/kayako.js');
    expect(kayakoPostNote).toHaveBeenCalledWith(
      { domain: 'acme.kayako.com', email: 'a@b.com', password: 'pass' },
      42,
      'Note',
    );
  });

  it('creates a case', async () => {
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('901');
  });
});

describe('Kayako Classic adapter', () => {
  const adapter = getUpstreamAdapter('kayako-classic', { domain: 'classic.kayako.com', apiKey: 'key', secretKey: 'sec' })!;

  it('supports update and reply', () => {
    expect(adapter.supportsUpdate).toBe(true);
    expect(adapter.supportsReply).toBe(true);
  });

  it('posts a reply', async () => {
    await adapter.postReply('55', { body: 'Classic reply' });
    const { kayakoClassicPostReply } = await import('../../connectors/kayako-classic.js');
    expect(kayakoClassicPostReply).toHaveBeenCalledWith(
      { domain: 'classic.kayako.com', apiKey: 'key', secretKey: 'sec' },
      55,
      'Classic reply',
    );
  });

  it('posts a note', async () => {
    await adapter.postNote('55', { body: 'Classic note' });
    const { kayakoClassicPostNote } = await import('../../connectors/kayako-classic.js');
    expect(kayakoClassicPostNote).toHaveBeenCalledWith(
      { domain: 'classic.kayako.com', apiKey: 'key', secretKey: 'sec' },
      55,
      'Classic note',
    );
  });

  it('throws on createTicket without KAYAKO_CLASSIC_DEPARTMENT_ID', async () => {
    delete process.env.KAYAKO_CLASSIC_DEPARTMENT_ID;
    await expect(adapter.createTicket({ subject: 'Test', description: 'Body' }))
      .rejects.toThrow('KAYAKO_CLASSIC_DEPARTMENT_ID');
  });

  it('creates a ticket with KAYAKO_CLASSIC_DEPARTMENT_ID', async () => {
    process.env.KAYAKO_CLASSIC_DEPARTMENT_ID = '5';
    const result = await adapter.createTicket({ subject: 'Test', description: 'Body' });
    expect(result.externalId).toBe('1001');
    delete process.env.KAYAKO_CLASSIC_DEPARTMENT_ID;
  });
});
