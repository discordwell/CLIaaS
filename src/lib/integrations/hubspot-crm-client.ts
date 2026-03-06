/**
 * HubSpot CRM API client — extends existing HubSpot connector for CRM-specific operations.
 * Auth: Private App access token (Bearer).
 * Docs: https://developers.hubspot.com/docs/api/crm/
 */

export interface HubSpotCrmAuth {
  accessToken: string;
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    lifecyclestage?: string;
    hs_lead_status?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    industry?: string;
    annualrevenue?: string;
    numberofemployees?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    dealstage?: string;
    amount?: string;
    closedate?: string;
    pipeline?: string;
    hubspot_owner_id?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
}

export interface HubSpotSearchResult<T> {
  total: number;
  results: T[];
  paging?: { next?: { after: string } };
}

// ---- Client ----

const HUBSPOT_API = 'https://api.hubapi.com';

export class HubSpotCrmClient {
  private accessToken: string;

  constructor(auth: HubSpotCrmAuth) {
    this.accessToken = auth.accessToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${HUBSPOT_API}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HubSpot API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ---- Verify ----

  async verify(): Promise<{ portalId: number; accountType: string }> {
    const info = await this.request<{ portalId: number; accountType: string }>(
      'GET', '/account-info/v3/details',
    );
    return info;
  }

  // ---- Contacts ----

  async getContacts(limit = 100): Promise<HubSpotContact[]> {
    const result = await this.request<HubSpotSearchResult<HubSpotContact>>(
      'GET', `/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,phone,company,lifecyclestage,hs_lead_status`,
    );
    return result.results;
  }

  async findContactByEmail(email: string): Promise<HubSpotContact | null> {
    try {
      const result = await this.request<HubSpotSearchResult<HubSpotContact>>(
        'POST', '/crm/v3/objects/contacts/search',
        {
          filterGroups: [{
            filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
          }],
          properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage'],
          limit: 1,
        },
      );
      return result.results[0] ?? null;
    } catch {
      return null;
    }
  }

  async getContact(id: string): Promise<HubSpotContact> {
    return this.request<HubSpotContact>(
      'GET', `/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email,phone,company,lifecyclestage,hs_lead_status`,
    );
  }

  async updateContact(id: string, properties: Record<string, string>): Promise<HubSpotContact> {
    return this.request<HubSpotContact>(
      'PATCH', `/crm/v3/objects/contacts/${id}`,
      { properties },
    );
  }

  // ---- Companies ----

  async getCompanies(limit = 100): Promise<HubSpotCompany[]> {
    const result = await this.request<HubSpotSearchResult<HubSpotCompany>>(
      'GET', `/crm/v3/objects/companies?limit=${limit}&properties=name,domain,industry,annualrevenue,numberofemployees`,
    );
    return result.results;
  }

  async getCompany(id: string): Promise<HubSpotCompany> {
    return this.request<HubSpotCompany>(
      'GET', `/crm/v3/objects/companies/${id}?properties=name,domain,industry,annualrevenue,numberofemployees`,
    );
  }

  // ---- Deals ----

  async getDeals(limit = 100): Promise<HubSpotDeal[]> {
    const result = await this.request<HubSpotSearchResult<HubSpotDeal>>(
      'GET', `/crm/v3/objects/deals?limit=${limit}&properties=dealname,dealstage,amount,closedate,pipeline,hubspot_owner_id`,
    );
    return result.results;
  }

  async getDealsByContact(contactId: string): Promise<HubSpotDeal[]> {
    try {
      const assocResult = await this.request<{ results: Array<{ id: string }> }>(
        'GET', `/crm/v3/objects/contacts/${contactId}/associations/deals`,
      );
      const dealIds = assocResult.results.map(r => r.id);
      if (!dealIds.length) return [];

      const deals: HubSpotDeal[] = [];
      for (const dealId of dealIds.slice(0, 25)) {
        const deal = await this.request<HubSpotDeal>(
          'GET', `/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,amount,closedate,pipeline`,
        );
        deals.push(deal);
      }
      return deals;
    } catch {
      return [];
    }
  }

  // ---- Associations ----

  async getAssociations(objectType: string, objectId: string, toObjectType: string): Promise<string[]> {
    try {
      const result = await this.request<{ results: Array<{ id: string }> }>(
        'GET', `/crm/v3/objects/${objectType}/${objectId}/associations/${toObjectType}`,
      );
      return result.results.map(r => r.id);
    } catch {
      return [];
    }
  }

  // ---- Search ----

  async searchContacts(query: string, limit = 20): Promise<HubSpotContact[]> {
    const result = await this.request<HubSpotSearchResult<HubSpotContact>>(
      'POST', '/crm/v3/objects/contacts/search',
      {
        query,
        properties: ['firstname', 'lastname', 'email', 'phone', 'company'],
        limit,
      },
    );
    return result.results;
  }

  // ---- Helper: build record URL ----

  contactUrl(id: string): string {
    return `https://app.hubspot.com/contacts/${id}`;
  }

  dealUrl(id: string): string {
    return `https://app.hubspot.com/deals/${id}`;
  }

  companyUrl(id: string): string {
    return `https://app.hubspot.com/companies/${id}`;
  }
}
