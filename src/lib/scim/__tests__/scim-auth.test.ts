import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSCIMAuth } from '../auth';

const ORIGINAL_TOKEN = process.env.SCIM_BEARER_TOKEN;

beforeEach(() => {
  process.env.SCIM_BEARER_TOKEN = 'test-scim-token';
});

afterEach(() => {
  if (ORIGINAL_TOKEN) {
    process.env.SCIM_BEARER_TOKEN = ORIGINAL_TOKEN;
  } else {
    delete process.env.SCIM_BEARER_TOKEN;
  }
});

describe('SCIM auth', () => {
  it('accepts valid bearer token', () => {
    expect(validateSCIMAuth('Bearer test-scim-token')).toBe(true);
  });

  it('rejects wrong token', () => {
    expect(validateSCIMAuth('Bearer wrong-token')).toBe(false);
  });

  it('rejects null header', () => {
    expect(validateSCIMAuth(null)).toBe(false);
  });

  it('rejects non-bearer scheme', () => {
    expect(validateSCIMAuth('Basic dGVzdDp0ZXN0')).toBe(false);
  });

  it('rejects when no SCIM_BEARER_TOKEN configured', () => {
    delete process.env.SCIM_BEARER_TOKEN;
    expect(validateSCIMAuth('Bearer test-scim-token')).toBe(false);
  });
});
