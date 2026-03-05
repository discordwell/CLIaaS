/**
 * Shared connector auth resolution.
 *
 * Resolves connector credentials from environment variables.
 * Used by both the downstream sync engine and upstream push engine.
 */

/**
 * Resolve connector auth from environment variables.
 * Each connector has its own env vars; this returns null if required vars are missing.
 */
export function resolveConnectorAuth(connector: string): Record<string, string> | null {
  switch (connector) {
    case 'zendesk': {
      const subdomain = process.env.ZENDESK_SUBDOMAIN;
      const email = process.env.ZENDESK_EMAIL;
      const token = process.env.ZENDESK_TOKEN;
      if (!subdomain || !email || !token) return null;
      return { subdomain, email, token };
    }
    case 'kayako': {
      const domain = process.env.KAYAKO_DOMAIN;
      const email = process.env.KAYAKO_EMAIL;
      const password = process.env.KAYAKO_PASSWORD;
      if (!domain || !email || !password) return null;
      return { domain, email, password };
    }
    case 'kayako-classic': {
      const domain = process.env.KAYAKO_CLASSIC_DOMAIN;
      const apiKey = process.env.KAYAKO_CLASSIC_APIKEY ?? process.env.KAYAKO_CLASSIC_API_KEY;
      const secretKey = process.env.KAYAKO_CLASSIC_SECRET ?? process.env.KAYAKO_CLASSIC_SECRET_KEY;
      if (!domain || !apiKey || !secretKey) return null;
      return { domain, apiKey, secretKey };
    }
    case 'freshdesk': {
      const domain = process.env.FRESHDESK_SUBDOMAIN ?? process.env.FRESHDESK_DOMAIN;
      const apiKey = process.env.FRESHDESK_API_KEY;
      if (!domain || !apiKey) return null;
      return { domain, apiKey };
    }
    case 'helpcrunch': {
      const apiKey = process.env.HELPCRUNCH_API_KEY;
      if (!apiKey) return null;
      return { apiKey };
    }
    case 'groove': {
      const apiKey = process.env.GROOVE_API_TOKEN ?? process.env.GROOVE_API_KEY;
      if (!apiKey) return null;
      return { apiKey };
    }
    case 'intercom': {
      const token = process.env.INTERCOM_ACCESS_TOKEN ?? process.env.INTERCOM_TOKEN;
      if (!token) return null;
      return { token };
    }
    case 'helpscout': {
      const appId = process.env.HELPSCOUT_APP_ID;
      const appSecret = process.env.HELPSCOUT_APP_SECRET;
      if (!appId || !appSecret) return null;
      return { appId, appSecret };
    }
    case 'zoho-desk': {
      const domain = process.env.ZOHO_DESK_API_DOMAIN ?? process.env.ZOHO_DESK_DOMAIN;
      const orgId = process.env.ZOHO_DESK_ORG_ID;
      const token = process.env.ZOHO_DESK_ACCESS_TOKEN ?? process.env.ZOHO_DESK_TOKEN;
      if (!domain || !orgId || !token) return null;
      return { domain, orgId, token };
    }
    case 'hubspot': {
      const token = process.env.HUBSPOT_ACCESS_TOKEN ?? process.env.HUBSPOT_TOKEN;
      if (!token) return null;
      return { token };
    }
    default:
      return null;
  }
}
