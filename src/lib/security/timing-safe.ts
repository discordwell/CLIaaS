/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 *
 * Use this whenever comparing a caller-supplied value against a secret:
 * webhook secrets, verify tokens, HMAC signatures, API keys, OTP codes.
 * A plain === comparison short-circuits on the first differing character,
 * which lets an attacker recover the secret byte-by-byte from response
 * latency. This comparison always scans the full length of both inputs.
 *
 * Accepts null/undefined so callers can pass raw header values directly;
 * a missing value never matches.
 */
export function timingSafeStringEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length; // non-zero if lengths differ
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}
