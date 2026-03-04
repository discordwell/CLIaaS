/**
 * Email validation utilities.
 *
 * Provides basic format checks and rejects non-ASCII (e.g. Cyrillic homoglyph)
 * characters in the domain part to prevent phishing attacks.
 */

// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\x00-\x7F]/;

/**
 * Validates an email address:
 *  1. Must contain exactly one '@'
 *  2. Local part (before @) must be non-empty
 *  3. Domain part (after @) must contain at least one dot
 *  4. Domain part must contain only ASCII characters (rejects Cyrillic homoglyphs etc.)
 *
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateEmail(email: string): { valid: true } | { valid: false; reason: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'Email is required' };
  }

  const trimmed = email.trim();

  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) {
    return { valid: false, reason: 'Invalid email address' };
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  if (!local) {
    return { valid: false, reason: 'Invalid email address' };
  }

  // Reject multiple @ signs
  if (domain.includes('@')) {
    return { valid: false, reason: 'Invalid email address' };
  }

  // Domain must have at least one dot (e.g. "example.com")
  if (!domain.includes('.')) {
    return { valid: false, reason: 'Invalid email address' };
  }

  // Reject non-ASCII characters in domain (prevents Cyrillic/homoglyph phishing)
  if (NON_ASCII_RE.test(domain)) {
    return { valid: false, reason: 'Invalid email address' };
  }

  return { valid: true };
}
