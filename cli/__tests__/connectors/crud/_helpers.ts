/**
 * Shared test helpers for connector CRUD tests.
 * Response builders, auth factories, JSONL reader, temp dir utilities.
 */

import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ---- Response builders ----

export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204, statusText: 'No Content' });
}

export function createdResponse(location: string): Response {
  return new Response(null, {
    status: 201,
    statusText: 'Created',
    headers: { Location: location },
  });
}

export function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/xml' },
  });
}

// ---- Auth factories ----

export const ZENDESK_AUTH = { subdomain: 'test', email: 'agent@test.com', token: 'zd-test-token' };
export const FRESHDESK_AUTH = { subdomain: 'test', apiKey: 'fd-test-key' };
export const KAYAKO_AUTH = { domain: 'test.kayako.com', email: 'agent@test.com', password: 'ky-pass' };
export const KAYAKO_CLASSIC_AUTH = { domain: 'classic.kayako.com', apiKey: 'kyc-api-key', secretKey: 'kyc-secret' };
export const GROOVE_AUTH = { apiToken: 'gv-test-token' };
export const HELPCRUNCH_AUTH = { apiKey: 'hc-test-key' };
export const INTERCOM_AUTH = { accessToken: 'ic-test-token' };
export const HELPSCOUT_AUTH = { appId: 'hs-app-id', appSecret: 'hs-app-secret' };
export const HUBSPOT_AUTH = { accessToken: 'hub-test-token' };
export const ZOHO_AUTH = { orgId: 'org-123', accessToken: 'zd-desk-token' };

// ---- OAuth helpers ----

export function oauthTokenResponse(token = 'hs-access-token-123', expiresIn = 7200): Response {
  return jsonResponse({ access_token: token, token_type: 'bearer', expires_in: expiresIn });
}

// ---- Temp dir utilities ----

export function createTempDir(prefix = 'cliaas-crud-test'): string {
  const dir = join(tmpdir(), `${prefix}-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

// ---- JSONL reader ----

export function readJsonlFile<T = Record<string, unknown>>(filePath: string): T[] {
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line) as T);
}

// ---- Live test gate ----

export function liveTestsEnabled(): boolean {
  return process.env.LIVE_TESTS === '1';
}
