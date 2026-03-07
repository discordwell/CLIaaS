import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';

export function registerCrmTools(server: McpServer): void {
  server.tool(
    'crm_customer_data',
    'Show CRM data (Salesforce/HubSpot) linked to a customer',
    {
      customerId: z.string().describe('CLIaaS customer ID'),
    },
    async ({ customerId }) => {
      try {
        const { getCrmDataForCustomer } = await import('@/lib/integrations/crm-sync.js');
        const data = await getCrmDataForCustomer(customerId);
        if (!data.length) return textResult({ message: 'No CRM data linked to this customer' });
        return textResult({ crm: data });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'crm_link_record',
    'Link a CRM record to a CLIaaS customer',
    {
      customerId: z.string().describe('CLIaaS customer ID'),
      provider: z.enum(['salesforce', 'hubspot-crm']).describe('CRM provider'),
      crmObjectType: z.string().describe('CRM object type (contact, account, deal, company)'),
      crmObjectId: z.string().describe('CRM record ID'),
      confirm: z.boolean().default(true).describe('Must be true to execute'),
    },
    async ({ customerId, provider, crmObjectType, crmObjectId, confirm }) => {
      if (!confirm) return textResult({ message: 'Set confirm=true to link record' });
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const link = linkStore.createCrmLink({
          workspaceId: 'default',
          provider,
          entityType: 'customer',
          entityId: customerId,
          crmObjectType,
          crmObjectId,
          crmData: {},
        });
        return textResult({ linked: link.id, objectType: crmObjectType, objectId: crmObjectId });
      } catch (err) {
        return errorResult(`Failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'crm_sync',
    'Trigger CRM sync (pull contacts from Salesforce or HubSpot, match to customers)',
    {
      provider: z.enum(['salesforce', 'hubspot-crm']).optional().describe('Sync a specific CRM provider'),
    },
    async ({ provider }) => {
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const results: Record<string, unknown>[] = [];

        const providers = provider ? [provider] : ['salesforce', 'hubspot-crm'];
        for (const p of providers) {
          const creds = await linkStore.getCredentials('default', p);
          if (!creds) {
            results.push({ provider: p, skipped: 'not configured' });
            continue;
          }
          // For now return status — full sync requires customer email map from data provider
          results.push({ provider: p, status: 'configured', message: 'Use the CRM sync API endpoint for full sync' });
        }

        return textResult({ syncResults: results });
      } catch (err) {
        return errorResult(`Sync failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'crm_search',
    'Search CRM records by email or name',
    {
      provider: z.enum(['salesforce', 'hubspot-crm']).describe('CRM provider to search'),
      query: z.string().describe('Search query (email or name)'),
    },
    async ({ provider, query }) => {
      try {
        const linkStore = await import('@/lib/integrations/link-store.js');
        const creds = await linkStore.getCredentials('default', provider);
        if (!creds) return errorResult(`${provider} not configured`);

        const credData = creds.credentials as Record<string, string>;

        if (provider === 'hubspot-crm') {
          const { HubSpotCrmClient } = await import('@/lib/integrations/hubspot-crm-client.js');
          const client = new HubSpotCrmClient({ accessToken: credData.accessToken });
          const contacts = await client.searchContacts(query, 10);
          return textResult({
            results: contacts.map(c => ({
              id: c.id,
              name: `${c.properties.firstname ?? ''} ${c.properties.lastname ?? ''}`.trim(),
              email: c.properties.email,
              company: c.properties.company,
            })),
          });
        }

        if (provider === 'salesforce') {
          const { SalesforceClient } = await import('@/lib/integrations/salesforce-client.js');
          const client = new SalesforceClient({ instanceUrl: credData.instanceUrl, accessToken: credData.accessToken });
          // Try email match first
          if (query.includes('@')) {
            const contact = await client.findContactByEmail(query);
            return textResult({ results: contact ? [{ id: contact.Id, name: contact.Name, email: contact.Email }] : [] });
          }
          // SOSL search — escape reserved SOSL characters to prevent injection
          const soslEscaped = query.replace(/[\\?&|!{}[\]()^~*:\"'+\-]/g, '\\$&');
          const records = await client.search(`FIND {${soslEscaped}} IN ALL FIELDS RETURNING Contact(Id, Name, Email), Account(Id, Name)`);
          return textResult({ results: records.map(r => ({ id: r.Id, ...r })) });
        }

        return errorResult('Unknown provider');
      } catch (err) {
        return errorResult(`Search failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}
