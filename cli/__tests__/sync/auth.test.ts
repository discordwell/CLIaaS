import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveConnectorAuth } from '../../sync/auth.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveConnectorAuth', () => {
  it('returns null for unknown connector', () => {
    expect(resolveConnectorAuth('nonexistent')).toBeNull();
  });

  // ---- Zendesk ----
  it('resolves zendesk auth when all env vars set', () => {
    vi.stubEnv('ZENDESK_SUBDOMAIN', 'acme');
    vi.stubEnv('ZENDESK_EMAIL', 'agent@acme.com');
    vi.stubEnv('ZENDESK_TOKEN', 'zd-token');

    const auth = resolveConnectorAuth('zendesk');
    expect(auth).toEqual({ subdomain: 'acme', email: 'agent@acme.com', token: 'zd-token' });
  });

  it('returns null for zendesk when token missing', () => {
    vi.stubEnv('ZENDESK_SUBDOMAIN', 'acme');
    vi.stubEnv('ZENDESK_EMAIL', 'agent@acme.com');
    vi.stubEnv('ZENDESK_TOKEN', '');

    expect(resolveConnectorAuth('zendesk')).toBeNull();
  });

  // ---- Freshdesk ----
  it('resolves freshdesk auth with FRESHDESK_SUBDOMAIN', () => {
    vi.stubEnv('FRESHDESK_SUBDOMAIN', 'myco');
    vi.stubEnv('FRESHDESK_API_KEY', 'fd-key');

    const auth = resolveConnectorAuth('freshdesk');
    expect(auth).toEqual({ domain: 'myco', apiKey: 'fd-key' });
  });

  it('resolves freshdesk auth with FRESHDESK_DOMAIN fallback', () => {
    vi.stubEnv('FRESHDESK_DOMAIN', 'myco2');
    vi.stubEnv('FRESHDESK_API_KEY', 'fd-key2');

    const auth = resolveConnectorAuth('freshdesk');
    expect(auth).toEqual({ domain: 'myco2', apiKey: 'fd-key2' });
  });

  // ---- HelpCrunch ----
  it('resolves helpcrunch auth', () => {
    vi.stubEnv('HELPCRUNCH_API_KEY', 'hc-key');
    expect(resolveConnectorAuth('helpcrunch')).toEqual({ apiKey: 'hc-key' });
  });

  // ---- Groove ----
  it('resolves groove auth with GROOVE_API_TOKEN', () => {
    vi.stubEnv('GROOVE_API_TOKEN', 'gv-token');
    expect(resolveConnectorAuth('groove')).toEqual({ apiKey: 'gv-token' });
  });

  it('resolves groove auth with GROOVE_API_KEY fallback', () => {
    vi.stubEnv('GROOVE_API_KEY', 'gv-key');
    expect(resolveConnectorAuth('groove')).toEqual({ apiKey: 'gv-key' });
  });

  // ---- Intercom ----
  it('resolves intercom auth with INTERCOM_ACCESS_TOKEN', () => {
    vi.stubEnv('INTERCOM_ACCESS_TOKEN', 'ic-token');
    expect(resolveConnectorAuth('intercom')).toEqual({ token: 'ic-token' });
  });

  it('resolves intercom auth with INTERCOM_TOKEN fallback', () => {
    vi.stubEnv('INTERCOM_TOKEN', 'ic-token2');
    expect(resolveConnectorAuth('intercom')).toEqual({ token: 'ic-token2' });
  });

  // ---- Help Scout ----
  it('resolves helpscout auth', () => {
    vi.stubEnv('HELPSCOUT_APP_ID', 'hs-id');
    vi.stubEnv('HELPSCOUT_APP_SECRET', 'hs-secret');
    expect(resolveConnectorAuth('helpscout')).toEqual({ appId: 'hs-id', appSecret: 'hs-secret' });
  });

  it('returns null for helpscout when secret missing', () => {
    vi.stubEnv('HELPSCOUT_APP_ID', 'hs-id');
    vi.stubEnv('HELPSCOUT_APP_SECRET', '');
    expect(resolveConnectorAuth('helpscout')).toBeNull();
  });

  // ---- Zoho Desk ----
  it('resolves zoho-desk auth', () => {
    vi.stubEnv('ZOHO_DESK_DOMAIN', 'desk.zoho.com');
    vi.stubEnv('ZOHO_DESK_ORG_ID', 'org-1');
    vi.stubEnv('ZOHO_DESK_TOKEN', 'zd-tok');
    expect(resolveConnectorAuth('zoho-desk')).toEqual({
      domain: 'desk.zoho.com',
      orgId: 'org-1',
      token: 'zd-tok',
    });
  });

  it('resolves zoho-desk with API_DOMAIN fallback', () => {
    vi.stubEnv('ZOHO_DESK_API_DOMAIN', 'api.zoho.com');
    vi.stubEnv('ZOHO_DESK_ORG_ID', 'org-2');
    vi.stubEnv('ZOHO_DESK_ACCESS_TOKEN', 'zd-tok2');
    expect(resolveConnectorAuth('zoho-desk')).toEqual({
      domain: 'api.zoho.com',
      orgId: 'org-2',
      token: 'zd-tok2',
    });
  });

  // ---- HubSpot ----
  it('resolves hubspot auth', () => {
    vi.stubEnv('HUBSPOT_TOKEN', 'hub-tok');
    expect(resolveConnectorAuth('hubspot')).toEqual({ token: 'hub-tok' });
  });

  it('resolves hubspot with ACCESS_TOKEN fallback', () => {
    vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'hub-tok2');
    expect(resolveConnectorAuth('hubspot')).toEqual({ token: 'hub-tok2' });
  });

  // ---- Kayako (unconfigured connectors) ----
  it('resolves kayako auth when vars set', () => {
    vi.stubEnv('KAYAKO_DOMAIN', 'support.co');
    vi.stubEnv('KAYAKO_EMAIL', 'a@b.com');
    vi.stubEnv('KAYAKO_PASSWORD', 'pw');
    expect(resolveConnectorAuth('kayako')).toEqual({ domain: 'support.co', email: 'a@b.com', password: 'pw' });
  });

  it('resolves kayako-classic auth', () => {
    vi.stubEnv('KAYAKO_CLASSIC_DOMAIN', 'classic.co');
    vi.stubEnv('KAYAKO_CLASSIC_APIKEY', 'kc-key');
    vi.stubEnv('KAYAKO_CLASSIC_SECRET', 'kc-secret');
    expect(resolveConnectorAuth('kayako-classic')).toEqual({
      domain: 'classic.co',
      apiKey: 'kc-key',
      secretKey: 'kc-secret',
    });
  });
});
