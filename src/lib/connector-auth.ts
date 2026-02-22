// Build auth objects for each connector from environment variables.
// Used by API routes to call connector functions on the server.

import type { ZendeskAuth } from '../../cli/connectors/zendesk';
import type { HelpcrunchAuth } from '../../cli/connectors/helpcrunch';
import type { FreshdeskAuth } from '../../cli/connectors/freshdesk';
import type { GrooveAuth } from '../../cli/connectors/groove';

export type ConnectorName = 'zendesk' | 'helpcrunch' | 'freshdesk' | 'groove';

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

export function getAuth(name: ConnectorName) {
  switch (name) {
    case 'zendesk': return getZendeskAuth();
    case 'helpcrunch': return getHelpcrunchAuth();
    case 'freshdesk': return getFreshdeskAuth();
    case 'groove': return getGrooveAuth();
  }
}
