/**
 * CRM sync engine — pulls contacts/accounts/deals from CRM,
 * matches to CLIaaS customers by email, caches data in crm_links.
 */
import { SalesforceClient, type SalesforceContact } from './salesforce-client';
import { HubSpotCrmClient, type HubSpotContact } from './hubspot-crm-client';
import * as linkStore from './link-store';

export interface CrmSyncResult {
  contactsProcessed: number;
  linksCreated: number;
  linksUpdated: number;
  errors: string[];
}

export interface CrmCustomerData {
  provider: string;
  links: Array<{
    id: string;
    crmObjectType: string;
    crmObjectId: string;
    crmObjectUrl?: string;
    crmData: Record<string, unknown>;
    lastSyncedAt?: string;
  }>;
}

// ---- Sync Salesforce Contacts → CLIaaS Customers ----

export async function syncSalesforceContacts(
  client: SalesforceClient,
  workspaceId: string,
  customerEmails: Map<string, string>, // email → customerId
): Promise<CrmSyncResult> {
  const result: CrmSyncResult = { contactsProcessed: 0, linksCreated: 0, linksUpdated: 0, errors: [] };

  try {
    const contacts = await client.getContacts(200);
    for (const contact of contacts) {
      result.contactsProcessed++;
      if (!contact.Email) continue;

      const customerId = customerEmails.get(contact.Email.toLowerCase());
      if (!customerId) continue;

      const existing = linkStore.listCrmLinks('customer', customerId, workspaceId)
        .find(l => l.provider === 'salesforce' && l.crmObjectId === contact.Id);

      const crmData: Record<string, unknown> = {
        name: contact.Name,
        email: contact.Email,
        phone: contact.Phone,
        title: contact.Title,
        accountId: contact.AccountId,
      };

      // Also pull account data if linked
      if (contact.AccountId) {
        try {
          const account = await client.getAccount(contact.AccountId);
          crmData.accountName = account.Name;
          crmData.industry = account.Industry;
          crmData.annualRevenue = account.AnnualRevenue;
        } catch { /* account fetch optional */ }
      }

      if (existing) {
        linkStore.updateCrmLink(existing.id, {
          crmData,
          lastSyncedAt: new Date().toISOString(),
        });
        result.linksUpdated++;
      } else {
        linkStore.createCrmLink({
          workspaceId,
          provider: 'salesforce',
          entityType: 'customer',
          entityId: customerId,
          crmObjectType: 'contact',
          crmObjectId: contact.Id,
          crmObjectUrl: client.recordUrl('Contact', contact.Id),
          crmData,
          lastSyncedAt: new Date().toISOString(),
        });
        result.linksCreated++;
      }
    }
  } catch (err) {
    result.errors.push(`Salesforce sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ---- Sync HubSpot Contacts → CLIaaS Customers ----

export async function syncHubSpotContacts(
  client: HubSpotCrmClient,
  workspaceId: string,
  customerEmails: Map<string, string>,
): Promise<CrmSyncResult> {
  const result: CrmSyncResult = { contactsProcessed: 0, linksCreated: 0, linksUpdated: 0, errors: [] };

  try {
    const contacts = await client.getContacts(200);
    for (const contact of contacts) {
      result.contactsProcessed++;
      const email = contact.properties.email;
      if (!email) continue;

      const customerId = customerEmails.get(email.toLowerCase());
      if (!customerId) continue;

      const existing = linkStore.listCrmLinks('customer', customerId, workspaceId)
        .find(l => l.provider === 'hubspot-crm' && l.crmObjectId === contact.id);

      const crmData: Record<string, unknown> = {
        name: `${contact.properties.firstname ?? ''} ${contact.properties.lastname ?? ''}`.trim(),
        email,
        phone: contact.properties.phone,
        company: contact.properties.company,
        lifecycleStage: contact.properties.lifecyclestage,
        leadStatus: contact.properties.hs_lead_status,
      };

      // Pull associated deals
      try {
        const deals = await client.getDealsByContact(contact.id);
        if (deals.length) {
          crmData.deals = deals.map(d => ({
            id: d.id,
            name: d.properties.dealname,
            stage: d.properties.dealstage,
            amount: d.properties.amount,
            closeDate: d.properties.closedate,
          }));
        }
      } catch { /* deals fetch optional */ }

      if (existing) {
        linkStore.updateCrmLink(existing.id, {
          crmData,
          lastSyncedAt: new Date().toISOString(),
        });
        result.linksUpdated++;
      } else {
        linkStore.createCrmLink({
          workspaceId,
          provider: 'hubspot-crm',
          entityType: 'customer',
          entityId: customerId,
          crmObjectType: 'contact',
          crmObjectId: contact.id,
          crmObjectUrl: client.contactUrl(contact.id),
          crmData,
          lastSyncedAt: new Date().toISOString(),
        });
        result.linksCreated++;
      }
    }
  } catch (err) {
    result.errors.push(`HubSpot sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ---- Get CRM Data for a Customer ----

export function getCrmDataForCustomer(customerId: string, workspaceId?: string): CrmCustomerData[] {
  const links = linkStore.listCrmLinks('customer', customerId, workspaceId);
  const byProvider: Record<string, CrmCustomerData> = {};

  for (const link of links) {
    if (!byProvider[link.provider]) {
      byProvider[link.provider] = { provider: link.provider, links: [] };
    }
    byProvider[link.provider].links.push({
      id: link.id,
      crmObjectType: link.crmObjectType,
      crmObjectId: link.crmObjectId,
      crmObjectUrl: link.crmObjectUrl,
      crmData: link.crmData,
      lastSyncedAt: link.lastSyncedAt,
    });
  }

  return Object.values(byProvider);
}

// ---- Get CRM Data for an Organization ----

export function getCrmDataForOrg(orgId: string, workspaceId?: string): CrmCustomerData[] {
  const links = linkStore.listCrmLinks('organization', orgId, workspaceId);
  const byProvider: Record<string, CrmCustomerData> = {};

  for (const link of links) {
    if (!byProvider[link.provider]) {
      byProvider[link.provider] = { provider: link.provider, links: [] };
    }
    byProvider[link.provider].links.push({
      id: link.id,
      crmObjectType: link.crmObjectType,
      crmObjectId: link.crmObjectId,
      crmObjectUrl: link.crmObjectUrl,
      crmData: link.crmData,
      lastSyncedAt: link.lastSyncedAt,
    });
  }

  return Object.values(byProvider);
}
