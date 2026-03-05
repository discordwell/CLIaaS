/**
 * Upstream adapter factory.
 *
 * Returns the appropriate ConnectorWriteAdapter for a given connector name,
 * or null for unsupported/unconfigured connectors (kayako, kayako-classic).
 */

import type { ConnectorWriteAdapter } from '../upstream-adapter.js';

import { createZendeskAdapter } from './zendesk.js';
import { createFreshdeskAdapter } from './freshdesk.js';
import { createGrooveAdapter } from './groove.js';
import { createHelpcrunchAdapter } from './helpcrunch.js';
import { createIntercomAdapter } from './intercom.js';
import { createHelpscoutAdapter } from './helpscout.js';
import { createZohoDeskAdapter } from './zoho-desk.js';
import { createHubspotAdapter } from './hubspot.js';

/**
 * Get an upstream write adapter for the given connector.
 *
 * Returns null for kayako/kayako-classic (intentionally unconfigured)
 * and for any unknown connector names.
 */
export function getUpstreamAdapter(
  connector: string,
  auth: Record<string, string>,
): ConnectorWriteAdapter | null {
  switch (connector) {
    case 'zendesk':
      return createZendeskAdapter(auth);
    case 'freshdesk':
      return createFreshdeskAdapter(auth);
    case 'groove':
      return createGrooveAdapter(auth);
    case 'helpcrunch':
      return createHelpcrunchAdapter(auth);
    case 'intercom':
      return createIntercomAdapter(auth);
    case 'helpscout':
      return createHelpscoutAdapter(auth);
    case 'zoho-desk':
      return createZohoDeskAdapter(auth);
    case 'hubspot':
      return createHubspotAdapter(auth);
    default:
      return null;
  }
}
