import { describe, it, expect } from 'vitest';
import { detectPII } from '../pii-detector';

describe('PII Detector', () => {
  describe('SSN detection', () => {
    it('detects SSN with dashes', () => {
      const result = detectPII('My SSN is 123-45-6789.');
      expect(result.hasPII).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].type).toBe('ssn');
    });

    it('detects SSN without dashes', () => {
      const result = detectPII('SSN: 123456789');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'ssn')).toBe(true);
    });

    it('ignores all-zero SSNs', () => {
      const result = detectPII('000-00-0000');
      expect(result.findings.filter(f => f.type === 'ssn')).toHaveLength(0);
    });
  });

  describe('credit card detection', () => {
    it('detects Visa card with spaces', () => {
      const result = detectPII('Card: 4111 1111 1111 1111');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'credit_card')).toBe(true);
    });

    it('detects card without spaces', () => {
      const result = detectPII('Card: 4111111111111111');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'credit_card')).toBe(true);
    });

    it('rejects numbers that fail Luhn check', () => {
      const result = detectPII('Not a card: 1234567890123456');
      expect(result.findings.filter(f => f.type === 'credit_card')).toHaveLength(0);
    });
  });

  describe('phone number detection', () => {
    it('detects US phone number', () => {
      const result = detectPII('Call me at (555) 123-4567');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'phone')).toBe(true);
    });

    it('detects phone with country code', () => {
      const result = detectPII('Phone: +1 555-123-4567');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'phone')).toBe(true);
    });
  });

  describe('API key detection', () => {
    it('detects sk- prefixed keys', () => {
      const result = detectPII('Key: sk-1234567890abcdefghijklmnop');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'api_key')).toBe(true);
    });

    it('detects token- prefixed keys', () => {
      const result = detectPII('token_abcdefghijklmnopqrstuvwxyz');
      expect(result.hasPII).toBe(true);
      expect(result.findings.some(f => f.type === 'api_key')).toBe(true);
    });
  });

  describe('clean text', () => {
    it('returns no PII for safe text', () => {
      const result = detectPII('Hello, how can I help you today? Your order #12345 is on the way.');
      expect(result.hasPII).toBe(false);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('redaction', () => {
    it('redacts findings', () => {
      const result = detectPII('SSN: 123-45-6789');
      expect(result.findings[0].redacted).toMatch(/\*\*\*/);
      expect(result.findings[0].redacted).not.toContain('123');
    });
  });
});
