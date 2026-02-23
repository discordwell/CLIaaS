import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_REGISTRY,
  ALL_CONNECTOR_IDS,
  resolveSource,
  extractExternalId,
  type ConnectorId,
} from '@/lib/connector-registry';

describe('connector registry', () => {
  it('contains all 10 connectors', () => {
    expect(ALL_CONNECTOR_IDS).toHaveLength(10);
    const expected: ConnectorId[] = [
      'zendesk', 'helpcrunch', 'freshdesk', 'groove',
      'intercom', 'helpscout', 'hubspot', 'zoho-desk',
      'kayako', 'kayako-classic',
    ];
    for (const id of expected) {
      expect(CONNECTOR_REGISTRY[id]).toBeDefined();
    }
  });

  it('every connector has all required fields', () => {
    for (const id of ALL_CONNECTOR_IDS) {
      const def = CONNECTOR_REGISTRY[id];
      expect(def.id).toBe(id);
      expect(def.name).toBeTruthy();
      expect(def.prefix).toMatch(/-$/);
      expect(def.envKeys.length).toBeGreaterThan(0);
      expect(def.exportDir).toBeTruthy();
      expect(['import', 'export', 'bidirectional']).toContain(def.direction);
      expect(['planned', 'building', 'ready']).toContain(def.status);
      expect(def.formats.length).toBeGreaterThan(0);
      expect(def.cliExample).toBeTruthy();
    }
  });
});

describe('resolveSource (from registry)', () => {
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
  });

  it('distinguishes zd- from zd2- and ky- from kyc-', () => {
    expect(resolveSource('zd-1')).toBe('zendesk');
    expect(resolveSource('zd2-1')).toBe('zoho-desk');
    expect(resolveSource('ky-1')).toBe('kayako');
    expect(resolveSource('kyc-1')).toBe('kayako-classic');
  });
});

describe('extractExternalId (from registry)', () => {
  it('strips all 10 prefixes', () => {
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
