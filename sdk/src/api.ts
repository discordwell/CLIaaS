import type { SDKConfig, SDKSession, SDKMessage, SDKCustomer } from './types';

export class SDKApiClient {
  private baseUrl: string;
  private workspaceId: string;
  private token: string | null = null;

  constructor(config: SDKConfig) {
    // Strip trailing slash from apiUrl
    this.baseUrl = config.apiUrl.replace(/\/+$/, '');
    this.workspaceId = config.workspaceId;
    if (config.customerToken) {
      this.token = config.customerToken;
    }
  }

  setToken(token: string): void {
    this.token = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  async init(customer?: SDKCustomer): Promise<SDKSession> {
    const res = await fetch(`${this.baseUrl}/api/sdk/init`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        workspaceId: this.workspaceId,
        customer,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Init failed' }));
      throw new Error((err as { error?: string }).error ?? `Init failed: ${res.status}`);
    }

    const session = (await res.json()) as SDKSession;
    this.token = session.token;
    return session;
  }

  async sendMessage(body: string): Promise<SDKMessage> {
    const res = await fetch(`${this.baseUrl}/api/sdk/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Send failed' }));
      throw new Error((err as { error?: string }).error ?? `Send failed: ${res.status}`);
    }

    return (await res.json()) as SDKMessage;
  }

  async getMessages(since?: string): Promise<SDKMessage[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);

    const url = `${this.baseUrl}/api/sdk/messages${params.toString() ? '?' + params.toString() : ''}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Fetch messages failed' }));
      throw new Error((err as { error?: string }).error ?? `Fetch messages failed: ${res.status}`);
    }

    const data = (await res.json()) as { messages: SDKMessage[] };
    return data.messages;
  }

  async uploadAttachment(file: File): Promise<{ id: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}/api/sdk/attachments`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error((err as { error?: string }).error ?? `Upload failed: ${res.status}`);
    }

    return (await res.json()) as { id: string; url: string };
  }
}
