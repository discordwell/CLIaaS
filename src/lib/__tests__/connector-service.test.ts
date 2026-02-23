import { describe, it, expect } from 'vitest';
import { resolveSource, extractExternalId } from '@/lib/connector-service';

describe('resolveSource', () => {
  it('resolves all 10 connector prefixes', () => {
    expect(resolveSource('zd-12345')).toBe('zendesk');
    expect(resolveSource('hc-99')).toBe('helpcrunch');
    expect(resolveSource('fd-42')).toBe('freshdesk');
    expect(resolveSource('gv-1')).toBe('groove');
    expect(resolveSource('ic-100')).toBe('intercom');
    expect(resolveSource('hs-200')).toBe('helpscout');
    expect(resolveSource('hb-300')).toBe('hubspot');
    expect(resolveSource('zd2-400')).toBe('zoho-desk');
    expect(resolveSource('ky-500')).toBe('kayako');
    expect(resolveSource('kyc-600')).toBe('kayako-classic');
  });

  it('returns null for unknown prefix', () => {
    expect(resolveSource('xx-123')).toBeNull();
    expect(resolveSource('nope')).toBeNull();
  });

  // Ensure zd2- is checked before zd- (longer prefix first)
  it('distinguishes zd- from zd2-', () => {
    expect(resolveSource('zd-1')).toBe('zendesk');
    expect(resolveSource('zd2-1')).toBe('zoho-desk');
  });
});

describe('extractExternalId', () => {
  it('strips all 10 connector prefixes', () => {
    expect(extractExternalId('zd-12345')).toBe('12345');
    expect(extractExternalId('hc-99')).toBe('99');
    expect(extractExternalId('fd-42')).toBe('42');
    expect(extractExternalId('gv-1')).toBe('1');
    expect(extractExternalId('ic-100')).toBe('100');
    expect(extractExternalId('hs-200')).toBe('200');
    expect(extractExternalId('hb-300')).toBe('300');
    expect(extractExternalId('zd2-400')).toBe('400');
    expect(extractExternalId('ky-500')).toBe('500');
    expect(extractExternalId('kyc-600')).toBe('600');
  });

  it('returns input unchanged for unknown prefix', () => {
    expect(extractExternalId('no-prefix')).toBe('no-prefix');
  });
});
