export interface SDKConfig {
  apiUrl: string;
  workspaceId: string;
  customerToken?: string;
}

export interface SDKCustomer {
  id?: string;
  name?: string;
  email?: string;
  customAttributes?: Record<string, unknown>;
}

export interface SDKMessage {
  id: string;
  body: string;
  authorType: 'customer' | 'agent' | 'bot';
  createdAt: string;
}

export interface SDKSession {
  sessionId: string;
  customerId: string;
  token: string;
}

export type SDKEvent = 'message:received' | 'session:started' | 'session:ended' | 'error';
export type SDKEventHandler = (data: unknown) => void;
