/**
 * Salesforce REST API client.
 * Auth: Username + Password + Security Token (for simplicity), or OAuth 2.0.
 * Docs: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/
 */

export interface SalesforceAuth {
  instanceUrl: string;     // e.g. 'https://acme.salesforce.com'
  accessToken: string;
}

export interface SalesforcePasswordAuth {
  loginUrl?: string;       // default: 'https://login.salesforce.com'
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;        // password + security token
}

export interface SalesforceRecord {
  Id: string;
  [key: string]: unknown;
}

export interface SalesforceQueryResult {
  totalSize: number;
  done: boolean;
  records: SalesforceRecord[];
  nextRecordsUrl?: string;
}

export interface SalesforceContact extends SalesforceRecord {
  Name: string;
  Email?: string;
  Phone?: string;
  AccountId?: string;
  Title?: string;
  OwnerId?: string;
}

export interface SalesforceAccount extends SalesforceRecord {
  Name: string;
  Website?: string;
  Industry?: string;
  AnnualRevenue?: number;
  NumberOfEmployees?: number;
  OwnerId?: string;
}

export interface SalesforceOpportunity extends SalesforceRecord {
  Name: string;
  StageName: string;
  Amount?: number;
  CloseDate?: string;
  AccountId?: string;
  OwnerId?: string;
  Probability?: number;
}

// ---- Client ----

export class SalesforceClient {
  private instanceUrl: string;
  private accessToken: string;

  constructor(auth: SalesforceAuth) {
    this.instanceUrl = auth.instanceUrl.replace(/\/$/, '');
    this.accessToken = auth.accessToken;
  }

  static async fromPassword(auth: SalesforcePasswordAuth): Promise<SalesforceClient> {
    const loginUrl = auth.loginUrl ?? 'https://login.salesforce.com';
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      username: auth.username,
      password: auth.password,
    });

    const res = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Salesforce auth failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json() as { access_token: string; instance_url: string };
    return new SalesforceClient({
      instanceUrl: data.instance_url,
      accessToken: data.access_token,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.instanceUrl}${path}`;
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
      throw new Error(`Salesforce API ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ---- Verify ----

  async verify(): Promise<{ organizationId: string; userId: string; displayName: string }> {
    const info = await this.request<{ user_id: string; organization_id: string; display_name: string }>(
      'GET', '/services/oauth2/userinfo',
    );
    return {
      organizationId: info.organization_id,
      userId: info.user_id,
      displayName: info.display_name,
    };
  }

  // ---- SOQL Query ----

  async query<T extends SalesforceRecord = SalesforceRecord>(soql: string): Promise<SalesforceQueryResult & { records: T[] }> {
    return this.request<SalesforceQueryResult & { records: T[] }>(
      'GET', `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
    );
  }

  // ---- Contacts ----

  async getContacts(limit = 100): Promise<SalesforceContact[]> {
    const result = await this.query<SalesforceContact>(
      `SELECT Id, Name, Email, Phone, AccountId, Title, OwnerId FROM Contact ORDER BY LastModifiedDate DESC LIMIT ${limit}`,
    );
    return result.records;
  }

  async findContactByEmail(email: string): Promise<SalesforceContact | null> {
    // Proper SOQL escaping: single quotes are escaped by doubling them, and
    // backslashes/other special chars are escaped to prevent SOQL injection.
    const escaped = email
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
    const result = await this.query<SalesforceContact>(
      `SELECT Id, Name, Email, Phone, AccountId, Title, OwnerId FROM Contact WHERE Email = '${escaped}'`,
    );
    return result.records[0] ?? null;
  }

  async getContact(id: string): Promise<SalesforceContact> {
    return this.request<SalesforceContact>('GET', `/services/data/v59.0/sobjects/Contact/${id}`);
  }

  async updateContact(id: string, fields: Record<string, unknown>): Promise<void> {
    await this.request<void>('PATCH', `/services/data/v59.0/sobjects/Contact/${id}`, fields);
  }

  // ---- Accounts ----

  async getAccounts(limit = 100): Promise<SalesforceAccount[]> {
    const result = await this.query<SalesforceAccount>(
      `SELECT Id, Name, Website, Industry, AnnualRevenue, NumberOfEmployees, OwnerId FROM Account ORDER BY LastModifiedDate DESC LIMIT ${limit}`,
    );
    return result.records;
  }

  async getAccount(id: string): Promise<SalesforceAccount> {
    return this.request<SalesforceAccount>('GET', `/services/data/v59.0/sobjects/Account/${id}`);
  }

  // ---- Opportunities ----

  async getOpportunities(accountId?: string, limit = 100): Promise<SalesforceOpportunity[]> {
    const safeLim = Math.max(1, Math.min(2000, Math.floor(limit)));
    const where = accountId
      ? ` WHERE AccountId = '${accountId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : '';
    const result = await this.query<SalesforceOpportunity>(
      `SELECT Id, Name, StageName, Amount, CloseDate, AccountId, OwnerId, Probability FROM Opportunity${where} ORDER BY CloseDate DESC LIMIT ${safeLim}`,
    );
    return result.records;
  }

  // ---- Search ----

  async search(sosl: string): Promise<SalesforceRecord[]> {
    const result = await this.request<{ searchRecords: SalesforceRecord[] }>(
      'GET', `/services/data/v59.0/search?q=${encodeURIComponent(sosl)}`,
    );
    return result.searchRecords;
  }

  // ---- Helper: build record URL ----

  recordUrl(objectType: string, recordId: string): string {
    return `${this.instanceUrl}/${recordId}`;
  }
}
