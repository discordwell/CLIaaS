/**
 * Single-use intermediate token store for MFA verification.
 * Prevents replay attacks by tracking JTI (JWT ID) claims.
 *
 * Pattern modeled on src/lib/portal/magic-link.ts — in-memory Map
 * stored on globalThis for persistence across hot reloads.
 */

interface TokenEntry {
  used: boolean;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasIntermediateTokens: Map<string, TokenEntry> | undefined;
}

function getStore(): Map<string, TokenEntry> {
  if (!globalThis.__cliaasIntermediateTokens) {
    globalThis.__cliaasIntermediateTokens = new Map();
  }
  return globalThis.__cliaasIntermediateTokens;
}

/**
 * Track a new intermediate token by its JTI.
 * Call this when creating an intermediate token.
 */
export function trackToken(jti: string, expiresAt: number): void {
  cleanupExpiredTokens();
  const store = getStore();
  store.set(jti, { used: false, expiresAt });
}

/**
 * Consume a token by its JTI. Returns true if the token was found
 * and not yet used. Returns false if the token was already consumed
 * or not found in the store.
 */
export function consumeToken(jti: string): boolean {
  const store = getStore();
  const entry = store.get(jti);

  if (!entry) return false;
  if (entry.used) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(jti);
    return false;
  }

  entry.used = true;
  return true;
}

/**
 * Remove expired and used entries from the store.
 */
export function cleanupExpiredTokens(): number {
  const store = getStore();
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of store) {
    if (now > entry.expiresAt || entry.used) {
      store.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}
