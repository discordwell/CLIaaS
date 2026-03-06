import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CAPABILITIES,
  getCapabilities,
  getAllCapabilities,
  getSyncTier,
} from '../../sync/capabilities.js';

describe('CONNECTOR_CAPABILITIES', () => {
  it('covers all 10 connectors', () => {
    const keys = Object.keys(CONNECTOR_CAPABILITIES);
    expect(keys).toHaveLength(10);
    expect(keys).toContain('zendesk');
    expect(keys).toContain('kayako');
    expect(keys).toContain('kayako-classic');
    expect(keys).toContain('hubspot');
    expect(keys).toContain('helpcrunch');
  });

  it('all connectors support read', () => {
    for (const [, cap] of Object.entries(CONNECTOR_CAPABILITIES)) {
      expect(cap.read).toBe(true);
    }
  });

  it('only zendesk supports incrementalSync', () => {
    expect(CONNECTOR_CAPABILITIES.zendesk.incrementalSync).toBe(true);
    for (const [name, cap] of Object.entries(CONNECTOR_CAPABILITIES)) {
      if (name !== 'zendesk') {
        expect(cap.incrementalSync).toBe(false);
      }
    }
  });
});

describe('getCapabilities', () => {
  it('returns capabilities for known connector', () => {
    const cap = getCapabilities('zendesk');
    expect(cap).not.toBeNull();
    expect(cap!.update).toBe(true);
  });

  it('returns null for unknown connector', () => {
    expect(getCapabilities('nonexistent')).toBeNull();
  });
});

describe('getAllCapabilities', () => {
  it('returns a copy of all capabilities', () => {
    const all = getAllCapabilities();
    expect(Object.keys(all)).toHaveLength(10);
    // Verify it's a copy
    all.zendesk.read = false;
    expect(CONNECTOR_CAPABILITIES.zendesk.read).toBe(true);
  });
});

describe('getSyncTier', () => {
  it('returns "full sync" when all write ops supported', () => {
    expect(getSyncTier(CONNECTOR_CAPABILITIES.zendesk)).toBe('full sync');
    expect(getSyncTier(CONNECTOR_CAPABILITIES.hubspot)).toBe('full sync');
    expect(getSyncTier(CONNECTOR_CAPABILITIES.kayako)).toBe('full sync');
  });

  it('returns "read + write" for partial write support', () => {
    expect(getSyncTier(CONNECTOR_CAPABILITIES.intercom)).toBe('read + write');
    expect(getSyncTier(CONNECTOR_CAPABILITIES.helpscout)).toBe('read + write');
    expect(getSyncTier(CONNECTOR_CAPABILITIES['zoho-desk'])).toBe('read + write');
  });

  it('returns "read only" when no write ops', () => {
    expect(getSyncTier({ read: true, incrementalSync: false, update: false, reply: false, note: false, create: false })).toBe('read only');
  });
});
