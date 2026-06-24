import { describe, it, expect } from 'vitest';
import { detectPiiRegex, validateLuhn, maskText, getDefaultRules, type PiiMatch, type PiiSensitivityRule } from '../pii-detector';

describe('PII Detector (Compliance)', () => {
  describe('SSN detection', () => {
    it('detects SSN with dashes', () => {
      const matches = detectPiiRegex('My SSN is 123-45-6789.');
      expect(matches.some(m => m.piiType === 'ssn')).toBe(true);
    });

    it('ignores SSNs starting with 000', () => {
      const matches = detectPiiRegex('000-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('ignores SSNs starting with 666', () => {
      const matches = detectPiiRegex('666-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('ignores SSNs starting with 9xx', () => {
      const matches = detectPiiRegex('900-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('has high confidence for SSNs', () => {
      const matches = detectPiiRegex('SSN: 123-45-6789');
      const ssn = matches.find(m => m.piiType === 'ssn');
      expect(ssn).toBeDefined();
      expect(ssn!.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('credit card detection', () => {
    it('detects Visa with spaces', () => {
      const matches = detectPiiRegex('Card: 4111 1111 1111 1111');
      expect(matches.some(m => m.piiType === 'credit_card')).toBe(true);
    });

    it('detects Visa without spaces', () => {
      const matches = detectPiiRegex('Card: 4111111111111111');
      expect(matches.some(m => m.piiType === 'credit_card')).toBe(true);
    });

    it('rejects numbers failing Luhn', () => {
      const matches = detectPiiRegex('Not a card: 1234567890123456');
      expect(matches.filter(m => m.piiType === 'credit_card')).toHaveLength(0);
    });

    it('detects Amex', () => {
      // 378282246310005 is a valid Amex test number
      const matches = detectPiiRegex('Amex: 378282246310005');
      expect(matches.some(m => m.piiType === 'credit_card')).toBe(true);
    });
  });

  describe('Luhn validation', () => {
    it('validates correct card numbers', () => {
      expect(validateLuhn('4111111111111111')).toBe(true);
      expect(validateLuhn('5500000000000004')).toBe(true);
      expect(validateLuhn('378282246310005')).toBe(true);
    });

    it('rejects invalid card numbers', () => {
      expect(validateLuhn('1234567890123456')).toBe(false);
      expect(validateLuhn('1111111111111112')).toBe(false);
    });

    it('rejects too-short numbers', () => {
      expect(validateLuhn('123456')).toBe(false);
    });
  });

  describe('phone detection', () => {
    it('detects US phone with parens', () => {
      const matches = detectPiiRegex('Call (555) 123-4567');
      expect(matches.some(m => m.piiType === 'phone')).toBe(true);
    });

    it('detects phone with country code', () => {
      const matches = detectPiiRegex('Phone: +1 555-123-4567');
      expect(matches.some(m => m.piiType === 'phone')).toBe(true);
    });
  });

  describe('email detection', () => {
    it('detects standard email', () => {
      const matches = detectPiiRegex('Email: user@example.com');
      expect(matches.some(m => m.piiType === 'email')).toBe(true);
    });

    it('detects email with dots and plus', () => {
      const matches = detectPiiRegex('Contact: first.last+tag@domain.co.uk');
      expect(matches.some(m => m.piiType === 'email')).toBe(true);
    });
  });

  describe('address detection', () => {
    it('detects US street address', () => {
      const matches = detectPiiRegex('I live at 123 Main Street');
      expect(matches.some(m => m.piiType === 'address')).toBe(true);
    });

    it('detects address with abbreviation', () => {
      const matches = detectPiiRegex('Send to 456 Oak Ave');
      expect(matches.some(m => m.piiType === 'address')).toBe(true);
    });
  });

  describe('DOB detection', () => {
    it('detects MM/DD/YYYY format', () => {
      const matches = detectPiiRegex('DOB: 01/15/1990');
      expect(matches.some(m => m.piiType === 'dob')).toBe(true);
    });

    it('rejects invalid months', () => {
      const matches = detectPiiRegex('Not a date: 13/15/1990');
      expect(matches.filter(m => m.piiType === 'dob')).toHaveLength(0);
    });
  });

  describe('passport detection', () => {
    it('detects US passport format', () => {
      const matches = detectPiiRegex('Passport: A12345678');
      expect(matches.some(m => m.piiType === 'passport')).toBe(true);
    });
  });

  describe('sensitivity rules', () => {
    it('respects disabled types', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'ssn', enabled: false, autoRedact: false, maskingStyle: 'full' },
        { piiType: 'email', enabled: true, autoRedact: false, maskingStyle: 'full' },
      ];
      const matches = detectPiiRegex('SSN: 123-45-6789, email: user@example.com', rules);
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
      expect(matches.filter(m => m.piiType === 'email')).toHaveLength(1);
    });

    it('supports custom patterns', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'medical_id', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: 'MRN:\\s*\\d{8}' },
      ];
      const matches = detectPiiRegex('Record MRN: 12345678', rules);
      expect(matches.some(m => m.piiType === 'medical_id')).toBe(true);
    });

    it('ignores invalid custom regex', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'custom', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: '[invalid(' },
      ];
      const matches = detectPiiRegex('Some text', rules);
      // Should not throw, just return no matches for the invalid pattern
      expect(matches.filter(m => m.piiType === 'custom')).toHaveLength(0);
    });

    it('rejects custom patterns exceeding 200 chars (ReDoS mitigation)', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'custom', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: '(a+)+'.repeat(50) },
      ];
      const matches = detectPiiRegex('aaaaaaaaaa', rules);
      expect(matches.filter(m => m.piiType === 'custom')).toHaveLength(0);
    });
  });

  describe('medical_id detection', () => {
    it('detects MRN format', () => {
      const matches = detectPiiRegex('Patient MRN-12345678 in system');
      expect(matches.some(m => m.piiType === 'medical_id')).toBe(true);
    });

    it('detects MBI format', () => {
      const matches = detectPiiRegex('Medicare MBI 1EG4TE5MK73');
      expect(matches.some(m => m.piiType === 'medical_id')).toBe(true);
    });
  });

  describe('maskText', () => {
    it('masks with full style', () => {
      const matches: PiiMatch[] = [{ piiType: 'ssn', text: '123-45-6789', start: 5, end: 16, confidence: 0.95, method: 'regex' }];
      const result = maskText('SSN: 123-45-6789 done', matches, 'full');
      expect(result).toBe('SSN: [REDACTED-SSN] done');
    });

    it('masks with partial style', () => {
      const matches: PiiMatch[] = [{ piiType: 'credit_card', text: '4111111111111111', start: 6, end: 22, confidence: 0.98, method: 'regex' }];
      const result = maskText('Card: 4111111111111111 ok', matches, 'partial');
      expect(result).toBe('Card: ***1111 ok');
    });

    it('handles multiple matches', () => {
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: '123-45-6789', start: 0, end: 11, confidence: 0.95, method: 'regex' },
        { piiType: 'email', text: 'a@b.com', start: 12, end: 19, confidence: 0.99, method: 'regex' },
      ];
      const result = maskText('123-45-6789 a@b.com', matches, 'full');
      expect(result).toBe('[REDACTED-SSN] [REDACTED-EMAIL]');
    });

    it('returns original text for empty matches', () => {
      expect(maskText('hello', [], 'full')).toBe('hello');
    });

    it('merges duplicate-span matches into one clean redaction', () => {
      // Two rules matching the exact same span (e.g. passport + drivers_license).
      // The pre-fix implementation produced garbled output like
      // "[REDACTED-DRIVERS-LICENSE]-PASSPORT]" from compounding offset shifts.
      const matches: PiiMatch[] = [
        { piiType: 'passport', text: 'A12345678', start: 6, end: 15, confidence: 0.75, method: 'regex' },
        { piiType: 'drivers_license', text: 'A12345678', start: 6, end: 15, confidence: 0.70, method: 'regex' },
      ];
      const result = maskText('ID is A12345678 on file', matches, 'full');
      expect(result).toBe('ID is [REDACTED-PASSPORT] on file');
      // The garbled pre-fix output contained both labels spliced together.
      expect(result).not.toContain('DRIVERS-LICENSE');
    });

    it('covers the full union of partially overlapping matches (no leak)', () => {
      // ssn [3,18) and phone [10,18) overlap; their union must be fully masked.
      const text = 'PRE' + 'X'.repeat(15) + 'POST';
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: 'X'.repeat(10), start: 3, end: 13, confidence: 0.9, method: 'regex' },
        { piiType: 'phone', text: 'X'.repeat(8), start: 10, end: 18, confidence: 0.8, method: 'regex' },
      ];
      const result = maskText(text, matches, 'full');
      // Highest-confidence match (ssn) labels the merged region; no stray X leaks.
      expect(result).toBe('PRE[REDACTED-SSN]POST');
      expect(result).not.toContain('X');
    });

    it('applies a per-match masking style via styleFor', () => {
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: '123-45-6789', start: 0, end: 11, confidence: 0.95, method: 'regex' },
        { piiType: 'credit_card', text: '4111111111111111', start: 12, end: 28, confidence: 0.98, method: 'regex' },
      ];
      const result = maskText('123-45-6789 4111111111111111', matches, 'full',
        (m) => (m.piiType === 'credit_card' ? 'partial' : 'full'));
      expect(result).toBe('[REDACTED-SSN] ***1111');
    });
  });

  describe('overlapping detection resolution', () => {
    it('collapses the passport/drivers_license same-span collision to one match', () => {
      // "A12345678" matches both passport (\\b[A-Z]\\d{8}\\b) and
      // drivers_license (\\b[A-Z]\\d{7,8}\\b) over the identical span.
      const matches = detectPiiRegex('License A12345678 expires');
      const collisions = matches.filter(
        m => m.piiType === 'passport' || m.piiType === 'drivers_license',
      );
      expect(collisions).toHaveLength(1);
      expect(collisions[0].piiType).toBe('passport'); // higher confidence wins
    });

    it('masks a detected same-span collision cleanly end-to-end', () => {
      const text = 'License A12345678 expires';
      const result = maskText(text, detectPiiRegex(text), 'full');
      expect(result).toBe('License [REDACTED-PASSPORT] expires');
    });

    it('keeps disjoint matches of the same general shape distinct', () => {
      // Two separate passport-like tokens must both be detected & masked.
      const text = 'A12345678 and B87654321';
      const matches = detectPiiRegex(text);
      const passports = matches.filter(m => m.piiType === 'passport');
      expect(passports).toHaveLength(2);
      expect(maskText(text, matches, 'full')).toBe('[REDACTED-PASSPORT] and [REDACTED-PASSPORT]');
    });
  });

  describe('getDefaultRules', () => {
    it('returns 10 default rules', () => {
      const rules = getDefaultRules();
      expect(rules).toHaveLength(10);
      expect(rules.every(r => r.enabled)).toBe(true);
      expect(rules.every(r => !r.autoRedact)).toBe(true);
    });
  });

  describe('clean text', () => {
    it('returns no PII for safe text', () => {
      const matches = detectPiiRegex('Hello, how can I help you today? Order #12345 is on the way.');
      // May match phone-like patterns in some edge cases, but core types should be empty
      const sensitive = matches.filter(m => m.piiType === 'ssn' || m.piiType === 'credit_card');
      expect(sensitive).toHaveLength(0);
    });
  });
});
