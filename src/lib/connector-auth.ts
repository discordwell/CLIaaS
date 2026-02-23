// Build auth objects for each connector from environment variables.
// Used by API routes to call connector functions on the server.

import type { ConnectorId } from './connector-registry';
import type { ZendeskAuth } from '../../cli/connectors/zendesk';
import type { HelpcrunchAuth } from '../../cli/connectors/helpcrunch';
import type { FreshdeskAuth } from '../../cli/connectors/freshdesk';
import type { GrooveAuth } from '../../cli/connectors/groove';
import type { IntercomAuth } from '../../cli/connectors/intercom';
import type { HelpScoutAuth } from '../../cli/connectors/helpscout';
import type { HubSpotAuth } from '../../cli/connectors/hubspot';
import type { ZohoDeskAuth } from '../../cli/connectors/zoho-desk';
import type { KayakoAuth } from '../../cli/connectors/kayako';
import type { KayakoClassicAuth } from '../../cli/connectors/kayako-classic';

export type ConnectorName = ConnectorId;

export function getZendeskAuth(): ZendeskAuth | null {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const email = process.env.ZENDESK_EMAIL;
  const token = process.env.ZENDESK_TOKEN;
  if (!subdomain || !email || !token) return null;
  return { subdomain, email, token };
}

export function getHelpcrunchAuth(): HelpcrunchAuth | null {
  const apiKey = process.env.HELPCRUNCH_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

export function getFreshdeskAuth(): FreshdeskAuth | null {
  const subdomain = process.env.FRESHDESK_SUBDOMAIN;
  const apiKey = process.env.FRESHDESK_API_KEY;
  if (!subdomain || !apiKey) return null;
  return { subdomain, apiKey };
}

export function getGrooveAuth(): GrooveAuth | null {
  const apiToken = process.env.GROOVE_API_TOKEN;
  if (!apiToken) return null;
  return { apiToken };
}

export function getIntercomAuth(): IntercomAuth | null {
  const accessToken = process.env.INTERCOM_ACCESS_TOKEN;
  if (!accessToken) return null;
  return { accessToken };
}

export function getHelpScoutAuth(): HelpScoutAuth | null {
  const appId = process.env.HELPSCOUT_APP_ID;
  const appSecret = process.env.HELPSCOUT_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function getHubSpotAuth(): HubSpotAuth | null {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;
  return { accessToken };
}

export function getZohoDeskAuth(): ZohoDeskAuth | null {
  const orgId = process.env.ZOHO_DESK_ORG_ID;
  const accessToken = process.env.ZOHO_DESK_ACCESS_TOKEN;
  if (!orgId || !accessToken) return null;
  return { orgId, accessToken };
}

export function getKayakoAuth(): KayakoAuth | null {
  const domain = process.env.KAYAKO_DOMAIN;
  const email = process.env.KAYAKO_EMAIL;
  const password = process.env.KAYAKO_PASSWORD;
  if (!domain || !email || !password) return null;
  return { domain, email, password };
}

export function getKayakoClassicAuth(): KayakoClassicAuth | null {
  const domain = process.env.KAYAKO_CLASSIC_DOMAIN;
  const apiKey = process.env.KAYAKO_CLASSIC_API_KEY;
  const secretKey = process.env.KAYAKO_CLASSIC_SECRET_KEY;
  if (!domain || !apiKey || !secretKey) return null;
  return { domain, apiKey, secretKey };
}

export function getAuth(name: ConnectorName) {
  switch (name) {
    case 'zendesk': return getZendeskAuth();
    case 'helpcrunch': return getHelpcrunchAuth();
    case 'freshdesk': return getFreshdeskAuth();
    case 'groove': return getGrooveAuth();
    case 'intercom': return getIntercomAuth();
    case 'helpscout': return getHelpScoutAuth();
    case 'hubspot': return getHubSpotAuth();
    case 'zoho-desk': return getZohoDeskAuth();
    case 'kayako': return getKayakoAuth();
    case 'kayako-classic': return getKayakoClassicAuth();
  }
}
