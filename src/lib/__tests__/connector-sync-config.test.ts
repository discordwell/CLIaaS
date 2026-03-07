import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import {
  getSyncConfig,
  updateSyncConfig,
  getDefaultSyncMode,
  shouldFallbackToPolling,
} from '@/lib/connector-service';
import type { ConnectorSyncConfig } from '@/lib/connector-service';

const TEST_DIR = '/tmp/cliaas-test-sync-config-' + process.pid;

describe('connector sync config', () => {
  beforeEach(() => {
    process.env.CLIAAS_DATA_DIR = TEST_DIR;
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    delete process.env.CLIAAS_DATA_DIR;
  });

  // ---- getDefaultSyncMode ----

  describe('getDefaultSyncMode', () => {
    it('returns "webhook" for webhook-capable connectors', () => {
      expect(getDefaultSyncMode('zendesk')).toBe('webhook');
      expect(getDefaultSyncMode('intercom')).toBe('webhook');
      expect(getDefaultSyncMode('freshdesk')).toBe('webhook');
      expect(getDefaultSyncMode('hubspot')).toBe('webhook');
    });

    it('returns "polling" for non-webhook connectors', () => {
      expect(getDefaultSyncMode('groove')).toBe('polling');
      expect(getDefaultSyncMode('helpcrunch')).toBe('polling');
      expect(getDefaultSyncMode('helpscout')).toBe('polling');
      expect(getDefaultSyncMode('zoho-desk')).toBe('polling');
      expect(getDefaultSyncMode('kayako')).toBe('polling');
      expect(getDefaultSyncMode('kayako-classic')).toBe('polling');
    });

    it('returns "polling" for unknown connectors', () => {
      expect(getDefaultSyncMode('nonexistent')).toBe('polling');
    });
  });

  // ---- getSyncConfig ----

  describe('getSyncConfig', () => {
    it('returns default config when no persisted config exists', () => {
      const config = getSyncConfig('zendesk');
      expect(config).toEqual({
        connectorId: 'zendesk',
        syncMode: 'webhook',
        pollingIntervalMs: 300_000,
        webhookVerified: false,
        fallbackToPolling: true,
      });
    });

    it('returns default polling config for non-webhook connector', () => {
      const config = getSyncConfig('groove');
      expect(config).toEqual({
        connectorId: 'groove',
        syncMode: 'polling',
        pollingIntervalMs: 300_000,
        webhookVerified: false,
        fallbackToPolling: false,
      });
    });

    it('returns persisted config after update', () => {
      updateSyncConfig('zendesk', { webhookVerified: true, lastWebhookAt: '2026-03-07T12:00:00Z' });
      const config = getSyncConfig('zendesk');
      expect(config.webhookVerified).toBe(true);
      expect(config.lastWebhookAt).toBe('2026-03-07T12:00:00Z');
    });
  });

  // ---- updateSyncConfig ----

  describe('updateSyncConfig', () => {
    it('creates config entry if none exists', () => {
      const result = updateSyncConfig('intercom', { syncMode: 'hybrid' });
      expect(result.connectorId).toBe('intercom');
      expect(result.syncMode).toBe('hybrid');
      expect(result.pollingIntervalMs).toBe(300_000); // default preserved
    });

    it('merges updates into existing config', () => {
      updateSyncConfig('zendesk', { pollingIntervalMs: 60_000 });
      const updated = updateSyncConfig('zendesk', { webhookVerified: true });
      expect(updated.pollingIntervalMs).toBe(60_000); // preserved from first update
      expect(updated.webhookVerified).toBe(true);
    });

    it('does not allow connectorId to be overwritten', () => {
      const result = updateSyncConfig('zendesk', { connectorId: 'intercom' } as Partial<ConnectorSyncConfig>);
      expect(result.connectorId).toBe('zendesk');
    });

    it('persists across separate reads', () => {
      updateSyncConfig('freshdesk', {
        syncMode: 'hybrid',
        pollingIntervalMs: 120_000,
        webhookVerified: true,
        lastWebhookAt: '2026-03-07T10:00:00Z',
        lastPollAt: '2026-03-07T09:55:00Z',
        fallbackToPolling: true,
      });

      // Read fresh (no in-memory cache)
      const config = getSyncConfig('freshdesk');
      expect(config).toEqual({
        connectorId: 'freshdesk',
        syncMode: 'hybrid',
        pollingIntervalMs: 120_000,
        webhookVerified: true,
        lastWebhookAt: '2026-03-07T10:00:00Z',
        lastPollAt: '2026-03-07T09:55:00Z',
        fallbackToPolling: true,
      });
    });

    it('handles multiple connectors independently', () => {
      updateSyncConfig('zendesk', { webhookVerified: true });
      updateSyncConfig('hubspot', { syncMode: 'hybrid' });

      const zd = getSyncConfig('zendesk');
      const hb = getSyncConfig('hubspot');
      expect(zd.webhookVerified).toBe(true);
      expect(zd.syncMode).toBe('webhook'); // default
      expect(hb.syncMode).toBe('hybrid');
      expect(hb.webhookVerified).toBe(false); // default
    });
  });

  // ---- shouldFallbackToPolling ----

  describe('shouldFallbackToPolling', () => {
    it('returns false for polling-mode connectors', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'groove',
        syncMode: 'polling',
        fallbackToPolling: true,
        webhookVerified: false,
      };
      expect(shouldFallbackToPolling(config)).toBe(false);
    });

    it('returns false when fallbackToPolling is disabled', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'zendesk',
        syncMode: 'webhook',
        fallbackToPolling: false,
        webhookVerified: false,
      };
      expect(shouldFallbackToPolling(config)).toBe(false);
    });

    it('returns true when webhookVerified is false and fallback enabled', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'zendesk',
        syncMode: 'webhook',
        fallbackToPolling: true,
        webhookVerified: false,
      };
      expect(shouldFallbackToPolling(config)).toBe(true);
    });

    it('returns true when lastWebhookAt is missing (webhook never received)', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'intercom',
        syncMode: 'webhook',
        fallbackToPolling: true,
        webhookVerified: true,
        // no lastWebhookAt
      };
      expect(shouldFallbackToPolling(config)).toBe(true);
    });

    it('returns true when webhook has been silent for >15 minutes', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'zendesk',
        syncMode: 'webhook',
        fallbackToPolling: true,
        webhookVerified: true,
        lastWebhookAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
      };
      expect(shouldFallbackToPolling(config)).toBe(true);
    });

    it('returns false when webhook was received recently', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'zendesk',
        syncMode: 'webhook',
        fallbackToPolling: true,
        webhookVerified: true,
        lastWebhookAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      };
      expect(shouldFallbackToPolling(config)).toBe(false);
    });

    it('returns true for hybrid mode when webhook silent', () => {
      const config: ConnectorSyncConfig = {
        connectorId: 'hubspot',
        syncMode: 'hybrid',
        fallbackToPolling: true,
        webhookVerified: true,
        lastWebhookAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      };
      expect(shouldFallbackToPolling(config)).toBe(true);
    });
  });
});
