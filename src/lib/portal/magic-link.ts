/**
 * Magic-link token generation, storage, and verification for portal auth.
 * Uses in-memory token store with TTL (15 minutes).
 */

import { randomUUID } from 'crypto';

export interface MagicLinkToken {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

declare global {
  // eslint-disable-next-line no-var
  var __cliaasPortalTokens: Map<string, MagicLinkToken> | undefined;
}

function getTokenStore(): Map<string, MagicLinkToken> {
  if (!global.__cliaasPortalTokens) {
    global.__cliaasPortalTokens = new Map();
  }
  return global.__cliaasPortalTokens;
}

export function generateToken(email: string): MagicLinkToken {
  cleanupExpiredTokens();
  const store = getTokenStore();
  const now = Date.now();
  const token: MagicLinkToken = {
    token: randomUUID(),
    email: email.trim().toLowerCase(),
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
    used: false,
  };
  store.set(token.token, token);
  return token;
}

export function verifyToken(tokenStr: string): { valid: boolean; email?: string; error?: string } {
  const store = getTokenStore();
  const token = store.get(tokenStr);

  if (!token) {
    return { valid: false, error: 'Token not found' };
  }

  if (token.used) {
    return { valid: false, error: 'Token already used' };
  }

  if (Date.now() > token.expiresAt) {
    store.delete(tokenStr);
    return { valid: false, error: 'Token expired' };
  }

  // Mark as used (single-use)
  token.used = true;

  return { valid: true, email: token.email };
}

export function cleanupExpiredTokens(): number {
  const store = getTokenStore();
  const now = Date.now();
  let cleaned = 0;
  for (const [key, token] of store) {
    if (now > token.expiresAt || token.used) {
      store.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}
