import { describe, it, expect } from 'vitest';
import {
  PERSONAL_EMAIL_DOMAINS,
  extractDomain,
  isPersonalEmail,
} from '@/lib/auth/personal-domains';

describe('personal-domains', () => {
  describe('extractDomain', () => {
    it('extracts and lowercases the domain from an email', () => {
      expect(extractDomain('alice@ACME.com')).toBe('acme.com');
    });

    it('handles subdomains', () => {
      expect(extractDomain('bob@mail.example.org')).toBe('mail.example.org');
    });

    it('returns empty string for invalid email', () => {
      expect(extractDomain('nodomain')).toBe('');
    });

    it('uses the last @ sign for edge cases', () => {
      expect(extractDomain('weird@name@gmail.com')).toBe('gmail.com');
    });
  });

  describe('isPersonalEmail', () => {
    it('detects common personal email providers', () => {
      expect(isPersonalEmail('user@gmail.com')).toBe(true);
      expect(isPersonalEmail('user@HOTMAIL.COM')).toBe(true);
      expect(isPersonalEmail('user@outlook.com')).toBe(true);
      expect(isPersonalEmail('user@icloud.com')).toBe(true);
      expect(isPersonalEmail('user@protonmail.com')).toBe(true);
      expect(isPersonalEmail('user@hey.com')).toBe(true);
    });

    it('returns false for work email domains', () => {
      expect(isPersonalEmail('alice@acme.com')).toBe(false);
      expect(isPersonalEmail('bob@stripe.com')).toBe(false);
      expect(isPersonalEmail('carol@cliaas.com')).toBe(false);
    });

    it('returns false for emails with no domain (empty string not in set)', () => {
      expect(isPersonalEmail('nodomain')).toBe(false);
    });
  });

  describe('PERSONAL_EMAIL_DOMAINS Set', () => {
    it('contains expected domains', () => {
      expect(PERSONAL_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('yahoo.com')).toBe(true);
      expect(PERSONAL_EMAIL_DOMAINS.has('proton.me')).toBe(true);
    });

    it('has a reasonable size (20+ domains)', () => {
      expect(PERSONAL_EMAIL_DOMAINS.size).toBeGreaterThanOrEqual(20);
    });
  });
});
