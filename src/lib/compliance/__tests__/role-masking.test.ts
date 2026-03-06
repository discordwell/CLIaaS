import { describe, it, expect } from 'vitest';
import { shouldMaskForRole, hasFullPiiAccess, applyMessageMasking, applyTicketMasking, applyCustomerMasking } from '../role-masking';

describe('Role-Based Masking', () => {
  describe('shouldMaskForRole', () => {
    it('masks for light_agent', () => {
      expect(shouldMaskForRole('light_agent')).toBe(true);
    });

    it('masks for viewer', () => {
      expect(shouldMaskForRole('viewer')).toBe(true);
    });

    it('masks for collaborator', () => {
      expect(shouldMaskForRole('collaborator')).toBe(true);
    });

    it('does not mask for admin', () => {
      expect(shouldMaskForRole('admin')).toBe(false);
    });

    it('does not mask for agent', () => {
      expect(shouldMaskForRole('agent')).toBe(false);
    });

    it('does not mask for owner', () => {
      expect(shouldMaskForRole('owner')).toBe(false);
    });
  });

  describe('hasFullPiiAccess', () => {
    it('grants full access to admin', () => {
      expect(hasFullPiiAccess('admin')).toBe(true);
    });

    it('grants full access to agent', () => {
      expect(hasFullPiiAccess('agent')).toBe(true);
    });

    it('denies full access to light_agent', () => {
      expect(hasFullPiiAccess('light_agent')).toBe(false);
    });
  });

  describe('applyMessageMasking', () => {
    const msg = { body: 'SSN: 123-45-6789', bodyRedacted: 'SSN: [REDACTED-SSN]', hasPii: true };

    it('returns redacted body for light_agent', () => {
      const result = applyMessageMasking(msg, 'light_agent');
      expect(result.body).toBe('SSN: [REDACTED-SSN]');
      expect(result.hasPii).toBe(true);
    });

    it('returns original body for admin', () => {
      const result = applyMessageMasking(msg, 'admin');
      expect(result.body).toBe('SSN: 123-45-6789');
    });

    it('returns original body when no PII', () => {
      const clean = { body: 'Hello world', hasPii: false };
      const result = applyMessageMasking(clean, 'light_agent');
      expect(result.body).toBe('Hello world');
    });

    it('falls back to original when no redacted version', () => {
      const noRedacted = { body: 'SSN: 123-45-6789', hasPii: true };
      const result = applyMessageMasking(noRedacted, 'light_agent');
      expect(result.body).toBe('SSN: 123-45-6789');
    });
  });

  describe('applyTicketMasking', () => {
    const ticket = { subject: 'Help', customerEmail: 'user@example.com', hasPii: true };

    it('masks email for viewer', () => {
      const result = applyTicketMasking(ticket, 'viewer');
      expect(result.customerEmail).not.toBe('user@example.com');
      expect(result.customerEmail).toContain('@');
      expect(result.customerEmail).toContain('***');
    });

    it('preserves email for admin', () => {
      const result = applyTicketMasking(ticket, 'admin');
      expect(result.customerEmail).toBe('user@example.com');
    });
  });

  describe('applyCustomerMasking', () => {
    const customer = { name: 'John', email: 'john@test.com', phone: '+1 555-123-4567' };

    it('masks email and phone for light_agent', () => {
      const result = applyCustomerMasking(customer, 'light_agent');
      expect(result.email).toContain('***');
      expect(result.phone).toContain('***');
      expect(result.name).toBe('John');
    });

    it('preserves all fields for agent', () => {
      const result = applyCustomerMasking(customer, 'agent');
      expect(result.email).toBe('john@test.com');
      expect(result.phone).toBe('+1 555-123-4567');
    });
  });
});
