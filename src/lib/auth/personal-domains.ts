/**
 * Personal email domain detection.
 * Used to determine whether a signup email belongs to a company (work) domain
 * or a consumer/personal email provider.
 *
 * This list is shared between client and server code — keep it dependency-free.
 */

export const PERSONAL_EMAIL_DOMAINS_LIST = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'zoho.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'tutanota.com',
  'hey.com',
] as const;

export const PERSONAL_EMAIL_DOMAINS = new Set<string>(PERSONAL_EMAIL_DOMAINS_LIST);

/** Extract the domain portion from an email address, lowercased. */
export function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  return email.slice(at + 1).toLowerCase();
}

/** Returns true if the email belongs to a personal/consumer email provider. */
export function isPersonalEmail(email: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(extractDomain(email));
}
