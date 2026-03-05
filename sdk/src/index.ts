import { SDKApiClient } from './api';
import { SDKRealtimeClient } from './realtime';
import type { SDKConfig, SDKCustomer, SDKEventHandler, SDKEvent } from './types';

let apiClient: SDKApiClient | null = null;
let realtimeClient: SDKRealtimeClient | null = null;
let currentConfig: SDKConfig | null = null;

/**
 * Initialize the CLIaaS SDK with the given configuration.
 * Must be called before any other SDK function.
 */
export function init(config: SDKConfig): void {
  currentConfig = config;
  apiClient = new SDKApiClient(config);
  realtimeClient = new SDKRealtimeClient();
}

/**
 * Identify the current customer and start a session.
 * Creates or finds the customer on the server side.
 */
export async function identify(customer: SDKCustomer): Promise<void> {
  if (!apiClient || !currentConfig) {
    throw new Error('SDK not initialized. Call init() first.');
  }

  const session = await apiClient.init(customer);

  // Connect real-time stream for incoming messages
  if (realtimeClient && currentConfig) {
    const messagesUrl = `${currentConfig.apiUrl.replace(/\/+$/, '')}/api/sdk/messages`;
    realtimeClient.connect(messagesUrl, session.token);
  }
}

/**
 * Open the support widget (trigger session start event).
 * In a headless SDK context this initializes the conversation session.
 */
export async function open(): Promise<void> {
  if (!apiClient) {
    throw new Error('SDK not initialized. Call init() first.');
  }

  // If no session exists yet, create an anonymous one
  const session = await apiClient.init();

  if (realtimeClient && currentConfig) {
    const messagesUrl = `${currentConfig.apiUrl.replace(/\/+$/, '')}/api/sdk/messages`;
    realtimeClient.connect(messagesUrl, session.token);
  }
}

/**
 * Close the support widget / disconnect real-time stream.
 */
export function close(): void {
  if (realtimeClient) {
    realtimeClient.disconnect();
  }
}

/**
 * Subscribe to SDK events.
 */
export function on(event: SDKEvent, handler: SDKEventHandler): void {
  if (!realtimeClient) {
    throw new Error('SDK not initialized. Call init() first.');
  }
  realtimeClient.on(event, handler);
}

/**
 * Send a message from the customer.
 */
export async function sendMessage(body: string): Promise<void> {
  if (!apiClient) {
    throw new Error('SDK not initialized. Call init() first.');
  }
  await apiClient.sendMessage(body);
}

// Re-export types for consumer convenience
export type { SDKConfig, SDKCustomer, SDKMessage, SDKSession, SDKEvent } from './types';
