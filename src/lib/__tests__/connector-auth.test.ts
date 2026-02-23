import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getZendeskAuth,
  getHelpcrunchAuth,
  getFreshdeskAuth,
  getGrooveAuth,
  getIntercomAuth,
  getHelpScoutAuth,
  getHubSpotAuth,
  getZohoDeskAuth,
  getKayakoAuth,
  getKayakoClassicAuth,
  getAuth,
} from '@/lib/connector-auth';

const savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  'ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN',
  'HELPCRUNCH_API_KEY',
  'FRESHDESK_SUBDOMAIN', 'FRESHDESK_API_KEY',
  'GROOVE_API_TOKEN',
  'INTERCOM_ACCESS_TOKEN',
  'HELPSCOUT_APP_ID', 'HELPSCOUT_APP_SECRET',
  'HUBSPOT_ACCESS_TOKEN',
  'ZOHO_DESK_ORG_ID', 'ZOHO_DESK_ACCESS_TOKEN',
  'KAYAKO_DOMAIN', 'KAYAKO_EMAIL', 'KAYAKO_PASSWORD',
  'KAYAKO_CLASSIC_DOMAIN', 'KAYAKO_CLASSIC_API_KEY', 'KAYAKO_CLASSIC_SECRET_KEY',
];

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

describe('connector auth functions', () => {
  it('getZendeskAuth returns null when env vars missing', () => {
    expect(getZendeskAuth()).toBeNull();
  });

  it('getZendeskAuth returns auth when configured', () => {
    process.env.ZENDESK_SUBDOMAIN = 'acme';
    process.env.ZENDESK_EMAIL = 'a@b.com';
    process.env.ZENDESK_TOKEN = 'tok';
    expect(getZendeskAuth()).toEqual({ subdomain: 'acme', email: 'a@b.com', token: 'tok' });
  });

  it('getIntercomAuth returns null when env vars missing', () => {
    expect(getIntercomAuth()).toBeNull();
  });

  it('getIntercomAuth returns auth when configured', () => {
    process.env.INTERCOM_ACCESS_TOKEN = 'ic-token';
    expect(getIntercomAuth()).toEqual({ accessToken: 'ic-token' });
  });

  it('getHelpScoutAuth returns null when env vars missing', () => {
    expect(getHelpScoutAuth()).toBeNull();
  });

  it('getHelpScoutAuth returns auth when configured', () => {
    process.env.HELPSCOUT_APP_ID = 'app1';
    process.env.HELPSCOUT_APP_SECRET = 'sec1';
    expect(getHelpScoutAuth()).toEqual({ appId: 'app1', appSecret: 'sec1' });
  });

  it('getHubSpotAuth returns null when missing', () => {
    expect(getHubSpotAuth()).toBeNull();
  });

  it('getHubSpotAuth returns auth when configured', () => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'hb-tok';
    expect(getHubSpotAuth()).toEqual({ accessToken: 'hb-tok' });
  });

  it('getZohoDeskAuth returns null when missing', () => {
    expect(getZohoDeskAuth()).toBeNull();
  });

  it('getZohoDeskAuth returns auth when configured', () => {
    process.env.ZOHO_DESK_ORG_ID = 'org1';
    process.env.ZOHO_DESK_ACCESS_TOKEN = 'zd-tok';
    expect(getZohoDeskAuth()).toEqual({ orgId: 'org1', accessToken: 'zd-tok' });
  });

  it('getKayakoAuth returns null when missing', () => {
    expect(getKayakoAuth()).toBeNull();
  });

  it('getKayakoAuth returns auth when configured', () => {
    process.env.KAYAKO_DOMAIN = 'acme.kayako.com';
    process.env.KAYAKO_EMAIL = 'a@b.com';
    process.env.KAYAKO_PASSWORD = 'pass';
    expect(getKayakoAuth()).toEqual({ domain: 'acme.kayako.com', email: 'a@b.com', password: 'pass' });
  });

  it('getKayakoClassicAuth returns null when missing', () => {
    expect(getKayakoClassicAuth()).toBeNull();
  });

  it('getKayakoClassicAuth returns auth when configured', () => {
    process.env.KAYAKO_CLASSIC_DOMAIN = 'acme.kayako.com';
    process.env.KAYAKO_CLASSIC_API_KEY = 'key1';
    process.env.KAYAKO_CLASSIC_SECRET_KEY = 'sec1';
    expect(getKayakoClassicAuth()).toEqual({ domain: 'acme.kayako.com', apiKey: 'key1', secretKey: 'sec1' });
  });
});

describe('getAuth router', () => {
  it('routes to correct auth function for each connector', () => {
    // All missing → null
    expect(getAuth('zendesk')).toBeNull();
    expect(getAuth('helpcrunch')).toBeNull();
    expect(getAuth('freshdesk')).toBeNull();
    expect(getAuth('groove')).toBeNull();
    expect(getAuth('intercom')).toBeNull();
    expect(getAuth('helpscout')).toBeNull();
    expect(getAuth('hubspot')).toBeNull();
    expect(getAuth('zoho-desk')).toBeNull();
    expect(getAuth('kayako')).toBeNull();
    expect(getAuth('kayako-classic')).toBeNull();
  });

  it('returns auth when configured for a new connector', () => {
    process.env.INTERCOM_ACCESS_TOKEN = 'tok';
    expect(getAuth('intercom')).toEqual({ accessToken: 'tok' });
  });
});
