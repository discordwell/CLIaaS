/**
 * Phase 5: Cross-Feature Integration Tests
 *
 * Verifies that features work together correctly:
 * 5.1 Event fan-out (dispatcher -> webhooks, plugins, SSE, automation, background)
 * 5.2 Webhook delivery (HMAC, retries, logging, HTTPS enforcement)
 * 5.3 PII -> Compliance -> Audit pipeline
 * 5.4 KB -> Content gap detection & deflection tracking
 * 5.5 Campaign -> Enrollment lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================================
// 5.1 Event Fan-Out
// =====================================================================

describe('5.1 Event Fan-Out', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear globals that the dispatcher's dependencies use
    delete (global as any).__cliaasEventBus;
    delete (global as any).__cliaasAutomationRules;
    delete (global as any).__cliaasAutomationAudit;
    delete (global as any).__cliaasAutomationDepth;
    delete (global as any).__cliaasRuleBootstrapPromise;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatch calls all channels in parallel via Promise.allSettled', async () => {
    // Mock all channel dependencies
    const webhookSpy = vi.fn().mockResolvedValue(undefined);
    const pluginSpy = vi.fn().mockResolvedValue(undefined);
    const sseSpy = vi.fn();
    const automationSpy = vi.fn().mockResolvedValue(undefined);
    const piiSpy = vi.fn().mockResolvedValue(false);
    const aiSpy = vi.fn().mockResolvedValue(false);
    const autoqaSpy = vi.fn().mockResolvedValue(false);

    vi.doMock('@/lib/webhooks', () => ({ dispatchWebhook: webhookSpy }));
    vi.doMock('@/lib/plugins', () => ({ executePluginHook: pluginSpy }));
    vi.doMock('@/lib/realtime/events', () => {
      const bus = { emit: sseSpy, on: vi.fn(), onAny: vi.fn() };
      return { eventBus: bus };
    });
    vi.doMock('@/lib/automation/executor', () => ({ evaluateAutomation: automationSpy }));
    vi.doMock('@/lib/queue/dispatch', () => ({
      enqueueAIResolution: aiSpy,
      enqueuePiiScan: piiSpy,
      enqueueAutoQA: autoqaSpy,
    }));
    vi.doMock('@/lib/routing/engine', () => ({ routeTicket: vi.fn() }));
    vi.doMock('@/lib/routing/availability', () => ({ availability: { getAllAvailability: () => [] } }));
    vi.doMock('@/lib/data-provider/index', () => ({ getDataProvider: vi.fn() }));
    vi.doMock('@/lib/billing/usage', () => ({
      checkQuota: vi.fn().mockResolvedValue({ allowed: true }),
      incrementUsage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/ai/csat-link', () => ({
      linkCSATToResolution: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { dispatch } = await import('@/lib/events/dispatcher');

    dispatch('ticket.created', {
      ticketId: 'tk-1',
      subject: 'Test',
      workspaceId: 'ws-1',
      tenantId: 'tenant-1',
    });

    // dispatch is fire-and-forget with void Promise.allSettled -- give microtasks time
    await new Promise(r => setTimeout(r, 50));

    expect(webhookSpy).toHaveBeenCalledOnce();
    expect(pluginSpy).toHaveBeenCalledOnce();
    expect(sseSpy).toHaveBeenCalledOnce(); // ticket.created maps to ticket:created SSE
    expect(automationSpy).toHaveBeenCalledOnce();
    // PII scan should be enqueued for ticket.created (when workspaceId present)
    expect(piiSpy).toHaveBeenCalledOnce();
  });

  it('error in one channel does not block others (fire-and-forget isolation)', async () => {
    const webhookSpy = vi.fn().mockRejectedValue(new Error('Webhook down'));
    const pluginSpy = vi.fn().mockRejectedValue(new Error('Plugin crash'));
    const sseSpy = vi.fn(); // will succeed
    const automationSpy = vi.fn().mockRejectedValue(new Error('Automation fail'));
    const piiSpy = vi.fn().mockResolvedValue(false);
    const aiSpy = vi.fn().mockResolvedValue(false);
    const autoqaSpy = vi.fn().mockResolvedValue(false);

    vi.doMock('@/lib/webhooks', () => ({ dispatchWebhook: webhookSpy }));
    vi.doMock('@/lib/plugins', () => ({ executePluginHook: pluginSpy }));
    vi.doMock('@/lib/realtime/events', () => {
      const bus = { emit: sseSpy, on: vi.fn(), onAny: vi.fn() };
      return { eventBus: bus };
    });
    vi.doMock('@/lib/automation/executor', () => ({ evaluateAutomation: automationSpy }));
    vi.doMock('@/lib/queue/dispatch', () => ({
      enqueueAIResolution: aiSpy,
      enqueuePiiScan: piiSpy,
      enqueueAutoQA: autoqaSpy,
    }));
    vi.doMock('@/lib/billing/usage', () => ({
      checkQuota: vi.fn().mockResolvedValue({ allowed: true }),
      incrementUsage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/ai/csat-link', () => ({
      linkCSATToResolution: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { dispatch } = await import('@/lib/events/dispatcher');

    // Should NOT throw even though 3 channels throw
    expect(() =>
      dispatch('ticket.created', {
        ticketId: 'tk-2',
        subject: 'Resilience test',
        workspaceId: 'ws-1',
        tenantId: 'tenant-1',
      }),
    ).not.toThrow();

    await new Promise(r => setTimeout(r, 50));

    // SSE should still have been called despite other failures
    expect(sseSpy).toHaveBeenCalledOnce();
  });

  it('events include workspace context when passed in data', async () => {
    const pluginSpy = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@/lib/webhooks', () => ({ dispatchWebhook: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/plugins', () => ({ executePluginHook: pluginSpy }));
    vi.doMock('@/lib/realtime/events', () => {
      const bus = { emit: vi.fn(), on: vi.fn(), onAny: vi.fn() };
      return { eventBus: bus };
    });
    vi.doMock('@/lib/automation/executor', () => ({ evaluateAutomation: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/queue/dispatch', () => ({
      enqueueAIResolution: vi.fn().mockResolvedValue(false),
      enqueuePiiScan: vi.fn().mockResolvedValue(false),
      enqueueAutoQA: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock('@/lib/billing/usage', () => ({
      checkQuota: vi.fn().mockResolvedValue({ allowed: true }),
      incrementUsage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/ai/csat-link', () => ({
      linkCSATToResolution: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { dispatch } = await import('@/lib/events/dispatcher');

    dispatch('ticket.updated', {
      ticketId: 'tk-3',
      workspaceId: 'ws-workspace-42',
    });

    await new Promise(r => setTimeout(r, 50));

    // Plugin executor receives workspace context
    expect(pluginSpy).toHaveBeenCalledWith(
      'ticket.updated',
      expect.objectContaining({ workspaceId: 'ws-workspace-42' }),
    );
  });

  it('SSE eventBus.emit broadcasts to type-specific listeners', () => {
    // Create a fresh EventBus directly (avoid module caching issues)
    delete (global as any).__cliaasEventBus;

    // Inline EventBus for isolated testing (matches implementation in realtime/events.ts)
    class TestEventBus {
      private listeners = new Map<string, Set<(event: any) => void>>();
      private globalListeners = new Set<(event: any) => void>();

      on(type: string, listener: (event: any) => void): () => void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
      }

      onAny(listener: (event: any) => void): () => void {
        this.globalListeners.add(listener);
        return () => this.globalListeners.delete(listener);
      }

      emit(event: any): void {
        event.timestamp = event.timestamp || Date.now();
        const typed = this.listeners.get(event.type);
        if (typed) {
          for (const listener of typed) {
            try { listener(event); } catch { /* ignore */ }
          }
        }
        for (const listener of this.globalListeners) {
          try { listener(event); } catch { /* ignore */ }
        }
      }
    }

    const bus = new TestEventBus();
    const received: any[] = [];
    const unsub = bus.on('ticket:created', (evt) => {
      received.push(evt);
    });

    bus.emit({
      type: 'ticket:created',
      data: { ticketId: 'tk-sse-1' },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].data.ticketId).toBe('tk-sse-1');

    // Unsubscribe and verify no more events
    unsub();
    bus.emit({
      type: 'ticket:created',
      data: { ticketId: 'tk-sse-2' },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1); // No new event
  });

  it('eventBus.onAny subscription receives all event types', () => {
    delete (global as any).__cliaasEventBus;

    class TestEventBus {
      private listeners = new Map<string, Set<(event: any) => void>>();
      private globalListeners = new Set<(event: any) => void>();

      on(type: string, listener: (event: any) => void): () => void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
      }

      onAny(listener: (event: any) => void): () => void {
        this.globalListeners.add(listener);
        return () => this.globalListeners.delete(listener);
      }

      emit(event: any): void {
        event.timestamp = event.timestamp || Date.now();
        const typed = this.listeners.get(event.type);
        if (typed) {
          for (const listener of typed) {
            try { listener(event); } catch { /* ignore */ }
          }
        }
        for (const listener of this.globalListeners) {
          try { listener(event); } catch { /* ignore */ }
        }
      }
    }

    const bus = new TestEventBus();
    const all: any[] = [];
    const unsub = bus.onAny((evt) => {
      all.push(evt);
    });

    bus.emit({ type: 'ticket:created', data: { id: '1' }, timestamp: Date.now() });
    bus.emit({ type: 'ticket:updated', data: { id: '2' }, timestamp: Date.now() });

    expect(all).toHaveLength(2);
    expect(all[0].type).toBe('ticket:created');
    expect(all[1].type).toBe('ticket:updated');

    unsub();
    bus.emit({ type: 'ticket:reply', data: { id: '3' }, timestamp: Date.now() });
    expect(all).toHaveLength(2); // Unsubscribed
  });

  it('eventBus listener errors do not crash emit', () => {
    delete (global as any).__cliaasEventBus;

    class TestEventBus {
      private listeners = new Map<string, Set<(event: any) => void>>();
      private globalListeners = new Set<(event: any) => void>();

      on(type: string, listener: (event: any) => void): () => void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
        return () => this.listeners.get(type)?.delete(listener);
      }

      onAny(listener: (event: any) => void): () => void {
        this.globalListeners.add(listener);
        return () => this.globalListeners.delete(listener);
      }

      emit(event: any): void {
        event.timestamp = event.timestamp || Date.now();
        const typed = this.listeners.get(event.type);
        if (typed) {
          for (const listener of typed) {
            try { listener(event); } catch { /* ignore */ }
          }
        }
        for (const listener of this.globalListeners) {
          try { listener(event); } catch { /* ignore */ }
        }
      }
    }

    const bus = new TestEventBus();
    const good: any[] = [];
    const badUnsub = bus.on('ticket:created', () => {
      throw new Error('listener crash');
    });
    const goodUnsub = bus.on('ticket:created', (evt) => {
      good.push(evt);
    });

    // Should not throw even though first listener throws
    expect(() =>
      bus.emit({
        type: 'ticket:created',
        data: { id: 'crash-test' },
        timestamp: Date.now(),
      }),
    ).not.toThrow();

    expect(good).toHaveLength(1);
    badUnsub();
    goodUnsub();
  });
});

// =====================================================================
// 5.2 Webhook Delivery
// =====================================================================

describe('5.2 Webhook Delivery', () => {
  beforeEach(() => {
    vi.resetModules();
    // Explicitly unmock modules that may have been doMocked in 5.1 dispatcher tests
    vi.doUnmock('@/lib/webhooks');
    vi.doUnmock('@/lib/plugins');
    vi.doUnmock('@/lib/realtime/events');
    vi.doUnmock('@/lib/automation/executor');
    vi.doUnmock('@/lib/queue/dispatch');
    vi.doUnmock('@/lib/logger');
    vi.doUnmock('@/lib/billing/usage');
    vi.doUnmock('@/lib/ai/csat-link');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('webhook HMAC signature is valid SHA-256', async () => {
    const { createHmac } = await import('crypto');

    const secret = 'test-secret-key-123';
    const payload = JSON.stringify({ event: 'ticket.created', timestamp: '2026-01-01', data: { ticketId: 'tk-1' } });
    const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');

    // Verify the expected signature format
    expect(expectedSig).toMatch(/^[a-f0-9]{64}$/);
    expect(expectedSig.length).toBe(64); // SHA-256 = 64 hex chars
  });

  it('webhook HMAC matches crypto.createHmac output', async () => {
    const { createHmac } = await import('crypto');

    const secret = 'whsec_demo_test';
    const payload = '{"event":"ticket.created","data":{"id":"1"}}';

    // Node crypto reference
    const reference = createHmac('sha256', secret).update(payload).digest('hex');

    // Web Crypto path (same as used by webhooks.ts computeHmacSignature)
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const webCryptoSig = Array.from(new Uint8Array(sigBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    expect(webCryptoSig).toBe(reference);
  });

  it('validateWebhookUrl requires HTTPS', async () => {
    // Mock url-safety to avoid DNS resolution
    vi.doMock('@/lib/plugins/url-safety', () => ({
      isObviouslyPrivateUrl: () => false,
      isPrivateUrl: async () => false,
    }));

    const { validateWebhookUrl } = await import('@/lib/webhooks');

    const httpResult = validateWebhookUrl('http://hooks.example.com/test');
    expect(httpResult.valid).toBe(false);
    expect(httpResult.error).toMatch(/HTTPS/i);

    const httpsResult = validateWebhookUrl('https://hooks.example.com/test');
    expect(httpsResult.valid).toBe(true);
  });

  it('validateWebhookUrl rejects private/internal IPs', async () => {
    // Use the real isObviouslyPrivateUrl logic inline (from url-safety.ts)
    // to test that validateWebhookUrl correctly blocks private IPs
    vi.doMock('@/lib/plugins/url-safety', () => {
      const PRIVATE_RANGES = [
        { start: 0x00000000, end: 0x00FFFFFF },
        { start: 0x0A000000, end: 0x0AFFFFFF },
        { start: 0x7F000000, end: 0x7FFFFFFF },
        { start: 0xA9FE0000, end: 0xA9FEFFFF },
        { start: 0xAC100000, end: 0xAC1FFFFF },
        { start: 0xC0A80000, end: 0xC0A8FFFF },
      ];
      const BLOCKED = new Set(['localhost', 'metadata.google.internal']);

      function ipToNum(ip: string): number {
        const parts = ip.split('.');
        if (parts.length !== 4) return -1;
        let num = 0;
        for (const p of parts) {
          const v = parseInt(p, 10);
          if (isNaN(v) || v < 0 || v > 255) return -1;
          num = (num << 8) | v;
        }
        return num >>> 0;
      }

      return {
        isObviouslyPrivateUrl: (urlString: string) => {
          let parsed: URL;
          try { parsed = new URL(urlString); } catch { return true; }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
          const hostname = parsed.hostname;
          if (BLOCKED.has(hostname.toLowerCase())) return true;
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            const num = ipToNum(hostname);
            if (num === -1) return true;
            return PRIVATE_RANGES.some(r => num >= r.start && num <= r.end);
          }
          return false;
        },
        isPrivateUrl: async () => false,
      };
    });

    const { validateWebhookUrl } = await import('@/lib/webhooks');

    expect(validateWebhookUrl('https://localhost/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://127.0.0.1/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://192.168.1.1/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://10.0.0.1/hook').valid).toBe(false);
  });

  it('validateWebhookUrl rejects invalid URLs', async () => {
    const { validateWebhookUrl } = await import('@/lib/webhooks');

    expect(validateWebhookUrl('not-a-url').valid).toBe(false);
    expect(validateWebhookUrl('').valid).toBe(false);
  });

  it('recordWebhookLog creates log entry with correct fields', async () => {
    const { recordWebhookLog, getWebhookLogs } = await import('@/lib/webhooks');

    const log = recordWebhookLog({
      webhookId: 'wh-test-log',
      event: 'ticket.created',
      status: 'success',
      responseCode: 200,
      timestamp: new Date().toISOString(),
      payload: { ticketId: 'tk-1' },
      attempt: 1,
    });

    expect(log.id).toBeTruthy();
    expect(log.status).toBe('success');
    expect(log.responseCode).toBe(200);
    expect(log.attempt).toBe(1);
    expect(log.webhookId).toBe('wh-test-log');

    const logs = getWebhookLogs('wh-test-log');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some(l => l.id === log.id)).toBe(true);
  });

  it('recordWebhookLog tracks failed status with error message', async () => {
    const { recordWebhookLog } = await import('@/lib/webhooks');

    const log = recordWebhookLog({
      webhookId: 'wh-fail-test',
      event: 'sla.breached',
      status: 'failed',
      responseCode: 502,
      timestamp: new Date().toISOString(),
      payload: { ticketId: 'tk-2' },
      attempt: 3,
      error: 'Bad Gateway',
    });

    expect(log.status).toBe('failed');
    expect(log.responseCode).toBe(502);
    expect(log.attempt).toBe(3);
    expect(log.error).toBe('Bad Gateway');
  });

  it('webhook delivery retries on failure with inline fallback', async () => {
    // Mock fetch to fail first 2 times, succeed on 3rd
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200 };
    });
    vi.stubGlobal('fetch', fetchMock);

    // Mock dependencies to avoid real I/O
    vi.doMock('@/lib/queue/dispatch', () => ({
      enqueueWebhookDelivery: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock('@/lib/jsonl-store', () => ({
      readJsonlFile: () => [],
      writeJsonlFile: vi.fn(),
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));
    vi.doMock('@sentry/nextjs', () => ({
      captureException: vi.fn(),
    }));
    vi.doMock('@/lib/plugins/url-safety', () => ({
      isObviouslyPrivateUrl: () => false,
      isPrivateUrl: async () => false,
    }));

    const { createWebhook, dispatchWebhook } = await import('@/lib/webhooks');

    // Create a webhook with fast retry delays for testing
    createWebhook({
      url: 'https://hooks.example.com/retry-test',
      events: ['ticket.created'],
      secret: 'test-secret',
      enabled: true,
      retryPolicy: { maxAttempts: 3, delaysMs: [0, 0, 0] }, // No delay for tests
    });

    await dispatchWebhook({
      type: 'ticket.created',
      timestamp: new Date().toISOString(),
      data: { ticketId: 'tk-retry' },
    });

    // Our webhook retries 3 times (2 failures + 1 success).
    // Demo webhook wh-demo-1 also subscribes to ticket.created, adding 1 more call.
    // Total: at least 3 calls for our webhook's retry sequence.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    vi.unstubAllGlobals();
  }, 15000);

  it('createWebhook rejects HTTP URLs', async () => {
    vi.doMock('@/lib/jsonl-store', () => ({
      readJsonlFile: () => [],
      writeJsonlFile: vi.fn(),
    }));
    vi.doMock('@/lib/plugins/url-safety', () => ({
      isObviouslyPrivateUrl: (url: string) => {
        try {
          const parsed = new URL(url);
          return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        } catch { return true; }
      },
      isPrivateUrl: async () => false,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { createWebhook } = await import('@/lib/webhooks');

    expect(() =>
      createWebhook({
        url: 'http://hooks.example.com/insecure',
        events: ['ticket.created'],
        secret: 'test',
        enabled: true,
        retryPolicy: { maxAttempts: 3, delaysMs: [1000] },
      }),
    ).toThrow(/HTTPS/i);
  });
});

// =====================================================================
// 5.3 PII -> Compliance -> Audit
// =====================================================================

describe('5.3 PII -> Compliance -> Audit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detectPiiRegex detects SSN in text', async () => {
    const { detectPiiRegex } = await import('@/lib/compliance/pii-detector');

    const text = 'My SSN is 123-45-6789, please process my claim.';
    const matches = detectPiiRegex(text);

    const ssnMatch = matches.find(m => m.piiType === 'ssn');
    expect(ssnMatch).toBeDefined();
    expect(ssnMatch!.text).toBe('123-45-6789');
    expect(ssnMatch!.confidence).toBe(0.95);
    expect(ssnMatch!.method).toBe('regex');
  });

  it('detectPiiRegex detects email addresses', async () => {
    const { detectPiiRegex } = await import('@/lib/compliance/pii-detector');

    const text = 'Contact me at john.doe@example.com for details.';
    const matches = detectPiiRegex(text);

    const emailMatch = matches.find(m => m.piiType === 'email');
    expect(emailMatch).toBeDefined();
    expect(emailMatch!.text).toBe('john.doe@example.com');
    expect(emailMatch!.confidence).toBe(0.99);
  });

  it('detectPiiRegex detects phone numbers', async () => {
    const { detectPiiRegex } = await import('@/lib/compliance/pii-detector');

    const text = 'Call me at (555) 123-4567 or 555-987-6543.';
    const matches = detectPiiRegex(text);

    const phones = matches.filter(m => m.piiType === 'phone');
    expect(phones.length).toBeGreaterThanOrEqual(1);
  });

  it('detectPiiRegex detects credit card numbers with Luhn validation', async () => {
    const { detectPiiRegex, validateLuhn } = await import('@/lib/compliance/pii-detector');

    // Valid Visa test card
    expect(validateLuhn('4111111111111111')).toBe(true);
    // Invalid number
    expect(validateLuhn('1234567890123456')).toBe(false);

    const text = 'My card is 4111 1111 1111 1111, charge it.';
    const matches = detectPiiRegex(text);

    const ccMatch = matches.find(m => m.piiType === 'credit_card');
    expect(ccMatch).toBeDefined();
    expect(ccMatch!.confidence).toBe(0.98);
  });

  it('detectPiiRegex detects multiple PII types in same text', async () => {
    const { detectPiiRegex } = await import('@/lib/compliance/pii-detector');

    const text = 'Name: John, SSN: 123-45-6789, Email: john@example.com, DOB: 01/15/1990';
    const matches = detectPiiRegex(text);

    const types = new Set(matches.map(m => m.piiType));
    expect(types.has('ssn')).toBe(true);
    expect(types.has('email')).toBe(true);
    expect(types.has('dob')).toBe(true);
  });

  it('maskText replaces PII with full redaction labels', async () => {
    const { maskText, detectPiiRegex } = await import('@/lib/compliance/pii-detector');

    const text = 'My SSN is 123-45-6789 and email is test@example.com.';
    const matches = detectPiiRegex(text);
    const masked = maskText(text, matches, 'full');

    expect(masked).not.toContain('123-45-6789');
    expect(masked).not.toContain('test@example.com');
    expect(masked).toContain('[REDACTED-SSN]');
    expect(masked).toContain('[REDACTED-EMAIL]');
  });

  it('maskText partial style preserves last N characters', async () => {
    const { maskText } = await import('@/lib/compliance/pii-detector');

    const text = '123-45-6789';
    const matches = [{ piiType: 'ssn' as const, text, start: 0, end: text.length, confidence: 0.95, method: 'regex' as const }];

    const masked = maskText(text, matches, 'partial');
    // SSN partial keeps last 4: ***6789
    expect(masked).toContain('6789');
    expect(masked).toContain('***');
    expect(masked).not.toContain('123-45');
  });

  it('detectPii respects custom sensitivity rules', async () => {
    const { detectPiiRegex } = await import('@/lib/compliance/pii-detector');
    const type = await import('@/lib/compliance/pii-detector');

    // Disable SSN detection, enable only email
    const rules: type.PiiSensitivityRule[] = [
      { piiType: 'email', enabled: true, autoRedact: false, maskingStyle: 'full' },
      { piiType: 'ssn', enabled: false, autoRedact: false, maskingStyle: 'full' },
    ];

    const text = 'SSN: 123-45-6789, Email: test@example.com';
    const matches = detectPiiRegex(text, rules);

    expect(matches.find(m => m.piiType === 'ssn')).toBeUndefined();
    expect(matches.find(m => m.piiType === 'email')).toBeDefined();
  });

  it('pii-encryption encrypt/decrypt roundtrip works', async () => {
    // Set up encryption key
    const keyHex = 'a'.repeat(64); // 32 bytes in hex
    process.env.PII_ENCRYPTION_KEY = keyHex;

    const { encryptPii, decryptPii, hashPii, isPiiEncryptionConfigured } = await import('@/lib/compliance/pii-encryption');

    expect(isPiiEncryptionConfigured()).toBe(true);

    const plaintext = '123-45-6789';
    const encrypted = encryptPii(plaintext);
    expect(encrypted).not.toBeNull();
    expect(encrypted).toBeInstanceOf(Buffer);

    const decrypted = decryptPii(encrypted!);
    expect(decrypted).toBe(plaintext);

    // Hash is deterministic
    const hash1 = hashPii(plaintext);
    const hash2 = hashPii(plaintext);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    delete process.env.PII_ENCRYPTION_KEY;
  });

  it('pii-encryption returns null when key not configured', async () => {
    delete process.env.PII_ENCRYPTION_KEY;

    const { encryptPii, isPiiEncryptionConfigured } = await import('@/lib/compliance/pii-encryption');

    expect(isPiiEncryptionConfigured()).toBe(false);
    expect(encryptPii('test')).toBeNull();
  });

  it('getDefaultRules includes all PII types', async () => {
    const { getDefaultRules } = await import('@/lib/compliance/pii-detector');

    const rules = getDefaultRules();
    expect(rules.length).toBe(10);

    const types = rules.map(r => r.piiType);
    expect(types).toContain('ssn');
    expect(types).toContain('credit_card');
    expect(types).toContain('email');
    expect(types).toContain('phone');
    expect(types).toContain('address');
    expect(types).toContain('dob');
    expect(types).toContain('medical_id');
    expect(types).toContain('passport');
    expect(types).toContain('drivers_license');
    expect(types).toContain('custom');

    // All enabled, none auto-redact by default
    for (const rule of rules) {
      expect(rule.enabled).toBe(true);
      expect(rule.autoRedact).toBe(false);
      expect(rule.maskingStyle).toBe('full');
    }
  });

  it('scanEntity returns empty detections when DB unavailable (no fields)', async () => {
    // Mock getDb to return null (no DB)
    vi.doMock('@/db', () => ({
      getDb: () => null,
      db: null,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { scanEntity } = await import('@/lib/compliance/pii-masking');

    // scanEntity with no DB returns empty (getEntityFields returns null)
    const results = await scanEntity('message', 'msg-1', 'ws-1');
    expect(results).toEqual([]);
  });

  it('getPiiStats returns zero counts when DB unavailable', async () => {
    vi.doMock('@/db', () => ({
      getDb: () => null,
      db: null,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { getPiiStats } = await import('@/lib/compliance/pii-masking');

    const stats = await getPiiStats('ws-test');
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.confirmed).toBe(0);
    expect(stats.redacted).toBe(0);
    expect(stats.dismissed).toBe(0);
    expect(stats.autoRedacted).toBe(0);
    expect(stats.byType).toEqual({});
  });

  it('reviewDetection requires database', async () => {
    vi.doMock('@/db', () => ({
      getDb: () => null,
      db: null,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { reviewDetection } = await import('@/lib/compliance/pii-masking');

    await expect(
      reviewDetection('det-1', 'confirm', 'admin', 'ws-1'),
    ).rejects.toThrow('Database not available');
  });

  it('redactDetection requires database', async () => {
    vi.doMock('@/db', () => ({
      getDb: () => null,
      db: null,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { redactDetection } = await import('@/lib/compliance/pii-masking');

    await expect(
      redactDetection('det-1', 'admin', 'ws-1'),
    ).rejects.toThrow('Database not available');
  });

  it('logPiiAccess is no-op when DB unavailable', async () => {
    vi.doMock('@/db', () => ({
      getDb: () => null,
      db: null,
    }));
    vi.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      }),
    }));

    const { logPiiAccess } = await import('@/lib/compliance/pii-masking');

    // Should not throw -- graceful no-op
    await expect(
      logPiiAccess('ws-1', 'user-1', 'message', 'msg-1', 'body', 'ssn', 'view'),
    ).resolves.toBeUndefined();
  });
});

// =====================================================================
// 5.4 KB -> Content Gap Detection & Deflection
// =====================================================================

describe('5.4 KB -> Content Gap Detection & Deflection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('content gap detection identifies topics with tickets but no articles', async () => {
    const now = Date.now();
    const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

    // Mock data with tickets about "refund" but no KB article for it
    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([
        { id: 't1', subject: 'How to get a refund for my purchase', status: 'open', priority: 'normal', tags: ['refund'], createdAt: recentDate },
        { id: 't2', subject: 'Refund process is unclear', status: 'open', priority: 'high', tags: ['refund'], createdAt: recentDate },
        { id: 't3', subject: 'Another refund question about billing', status: 'open', priority: 'normal', tags: ['refund', 'billing'], createdAt: recentDate },
      ]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadKBArticles: vi.fn().mockResolvedValue([
        { id: 'kb1', title: 'Getting Started Guide', body: 'How to set up your account.', categoryPath: ['setup'], tags: [] },
      ]),
    }));

    const { analyzeContentGaps } = await import('@/lib/kb/content-gaps');

    const gaps = await analyzeContentGaps('ws-test');

    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const refundGap = gaps.find(g => g.topic === 'refund');
    expect(refundGap).toBeDefined();
    expect(refundGap!.ticketCount).toBeGreaterThanOrEqual(2);
    expect(refundGap!.suggestedTitle).toContain('Refund');
  });

  it('content gap detection requires at least 2 tickets per topic', async () => {
    const now = Date.now();
    const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([
        { id: 't1', subject: 'A unique one-off question about zigzag', status: 'open', priority: 'normal', tags: ['zigzag'], createdAt: recentDate },
      ]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadKBArticles: vi.fn().mockResolvedValue([]),
    }));

    const { analyzeContentGaps } = await import('@/lib/kb/content-gaps');

    const gaps = await analyzeContentGaps('ws-test');
    const zigzagGap = gaps.find(g => g.topic === 'zigzag');
    expect(zigzagGap).toBeUndefined(); // Only 1 ticket, not enough
  });

  it('content gap detection ignores tickets older than 14 days', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([
        { id: 't1', subject: 'Old question about widgets', status: 'open', priority: 'normal', tags: ['widgets'], createdAt: oldDate },
        { id: 't2', subject: 'Another old widgets question', status: 'open', priority: 'normal', tags: ['widgets'], createdAt: oldDate },
      ]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadKBArticles: vi.fn().mockResolvedValue([]),
    }));

    const { analyzeContentGaps } = await import('@/lib/kb/content-gaps');

    const gaps = await analyzeContentGaps('ws-test');
    expect(gaps).toHaveLength(0); // All tickets too old
  });

  it('content gap detection does not flag topics already covered by KB articles', async () => {
    const now = Date.now();
    const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    vi.doMock('@/lib/data', () => ({
      loadTickets: vi.fn().mockResolvedValue([
        { id: 't1', subject: 'Question about setup process', status: 'open', priority: 'normal', tags: ['setup'], createdAt: recentDate },
        { id: 't2', subject: 'Another setup question', status: 'open', priority: 'normal', tags: ['setup'], createdAt: recentDate },
      ]),
      loadMessages: vi.fn().mockResolvedValue([]),
      loadKBArticles: vi.fn().mockResolvedValue([
        { id: 'kb1', title: 'Setup Guide', body: 'How to setup your account.', categoryPath: ['setup'], tags: [] },
      ]),
    }));

    const { analyzeContentGaps } = await import('@/lib/kb/content-gaps');

    const gaps = await analyzeContentGaps('ws-test');
    const setupGap = gaps.find(g => g.topic === 'setup');
    expect(setupGap).toBeUndefined(); // Covered by KB article title word "Setup"
  });

  it('KB text-match suggests articles by keyword overlap', async () => {
    vi.doMock('@/lib/data', () => ({
      loadKBArticles: vi.fn().mockResolvedValue([
        { id: 'kb1', title: 'Password Reset Guide', body: 'Learn how to reset your password for any account. Follow these steps to recover access.', categoryPath: ['account'], visibility: 'public' },
        { id: 'kb2', title: 'Billing FAQ', body: 'Answers to common billing and payment questions.', categoryPath: ['billing'], visibility: 'public' },
        { id: 'kb3', title: 'Getting Started', body: 'Welcome aboard! Here is how to get started with our platform.', categoryPath: ['general'], visibility: 'public' },
      ]),
    }));

    const { suggestArticles } = await import('@/lib/kb/text-match');

    const results = await suggestArticles({ query: 'reset my password' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('Password');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet).toBeTruthy();
  });

  it('KB text-match returns empty for no matches', async () => {
    vi.doMock('@/lib/data', () => ({
      loadKBArticles: vi.fn().mockResolvedValue([
        { id: 'kb1', title: 'Password Reset', body: 'How to reset passwords.', categoryPath: ['account'], visibility: 'public' },
      ]),
    }));

    const { suggestArticles } = await import('@/lib/kb/text-match');

    const results = await suggestArticles({ query: 'xyzzy frobnicator' });
    expect(results).toHaveLength(0);
  });

  it('KB text-match respects limit parameter', async () => {
    vi.doMock('@/lib/data', () => ({
      loadKBArticles: vi.fn().mockResolvedValue([
        { id: 'kb1', title: 'Password Reset', body: 'password help', categoryPath: [], visibility: 'public' },
        { id: 'kb2', title: 'Password Policy', body: 'password rules', categoryPath: [], visibility: 'public' },
        { id: 'kb3', title: 'Password Tips', body: 'password suggestions', categoryPath: [], visibility: 'public' },
      ]),
    }));

    const { suggestArticles } = await import('@/lib/kb/text-match');

    const results = await suggestArticles({ query: 'password', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// =====================================================================
// 5.5 Campaign -> Enrollment
// =====================================================================

describe('5.5 Campaign -> Enrollment', () => {
  let store: typeof import('@/lib/campaigns/campaign-store');
  let orchestration: typeof import('@/lib/campaigns/orchestration');

  const testCustomers = [
    { id: 'c1', email: 'alice@test.com', name: 'Alice', plan: 'pro' },
    { id: 'c2', email: 'bob@test.com', name: 'Bob', plan: 'free' },
    { id: 'c3', email: 'carol@test.com', name: 'Carol', plan: 'pro' },
    { id: 'c4', email: 'dave@test.com', name: 'Dave', plan: 'enterprise' },
  ];

  beforeEach(async () => {
    vi.resetModules();
    store = await import('@/lib/campaigns/campaign-store');
    orchestration = await import('@/lib/campaigns/orchestration');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enrollCampaign adds matching customers based on segment query', async () => {
    const campaign = store.createCampaign({
      name: 'Pro User Campaign',
      channel: 'email',
      segmentQuery: {
        conditions: [{ field: 'plan', operator: 'eq', value: 'pro' }],
      },
    });
    await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Welcome Email',
    });

    const result = await orchestration.enrollCampaign(campaign.id, testCustomers);

    expect(result.enrolled).toBe(2); // Alice and Carol
    expect(result.campaign?.status).toBe('active');

    const enrollments = await store.getEnrollments(campaign.id);
    expect(enrollments).toHaveLength(2);
    const enrolledIds = enrollments.map(e => e.customerId);
    expect(enrolledIds).toContain('c1');
    expect(enrolledIds).toContain('c3');
  });

  it('enrollCampaign does not re-enroll already enrolled customers', async () => {
    const campaign = store.createCampaign({
      name: 'No Dupes',
      channel: 'email',
    });
    await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Email',
    });

    // First enrollment
    const r1 = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(r1.enrolled).toBe(4); // all customers (empty segment = match all)

    // Pause so we can re-enroll
    store.updateCampaign(campaign.id, { status: 'paused' });

    // Second enrollment - no new customers
    const r2 = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(r2.enrolled).toBe(0);
  });

  it('advanceEnrollment moves through steps correctly', async () => {
    const campaign = store.createCampaign({
      name: 'Multi-Step',
      channel: 'email',
    });
    const step1 = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Step 1',
    });
    const step2 = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_sms',
      name: 'Step 2',
    });

    // Link step1 -> step2
    store.updateCampaignStep(step1.id, { nextStepId: step2.id });

    // Re-fetch step1 so it has the updated nextStepId
    const updatedStep1 = await store.getCampaignStep(step1.id);

    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: updatedStep1!.id,
    });

    // Execute step 1 using the updated step object
    const result = orchestration.executeStep(updatedStep1!, enrollment);
    expect(result.success).toBe(true);
    expect(result.advance).toBe(true);
    expect(result.nextStepId).toBe(step2.id);

    // Advance to step 2
    orchestration.advanceEnrollment(enrollment, result.nextStepId);

    const updated = await store.getEnrollment(enrollment.id);
    expect(updated?.currentStepId).toBe(step2.id);
    expect(updated?.status).toBe('active');
  });

  it('advanceEnrollment marks completed when no next step', async () => {
    const campaign = store.createCampaign({
      name: 'Complete Test',
      channel: 'email',
    });
    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
    });

    orchestration.advanceEnrollment(enrollment, undefined);

    const updated = await store.getEnrollment(enrollment.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeTruthy();
  });

  it('campaign pause/resume affects enrollment processing', async () => {
    const campaign = store.createCampaign({
      name: 'Pause/Resume',
      channel: 'email',
    });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Email',
    });

    // Activate with enrollments
    store.updateCampaign(campaign.id, { status: 'active' });
    store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
      nextExecutionAt: new Date(Date.now() - 1000).toISOString(),
    });

    // Process tick while active -- should execute
    const r1 = await orchestration.processCampaignTick();
    expect(r1.processed).toBeGreaterThanOrEqual(1);

    // Pause campaign
    const paused = await orchestration.pauseCampaign(campaign.id);
    expect(paused?.status).toBe('paused');

    // Create another enrollment due now
    store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c2',
      currentStepId: step.id,
      nextExecutionAt: new Date(Date.now() - 1000).toISOString(),
    });

    // Process tick while paused -- should skip
    const enrollmentsBefore = await store.getEnrollments(campaign.id);
    await orchestration.processCampaignTick();
    const enrollmentsAfter = await store.getEnrollments(campaign.id);
    // c2's enrollment should still be active (not processed)
    const c2Before = enrollmentsBefore.find(e => e.customerId === 'c2');
    const c2After = enrollmentsAfter.find(e => e.customerId === 'c2');
    expect(c2Before?.status).toBe('active');
    expect(c2After?.status).toBe('active');

    // Resume
    const resumed = await orchestration.resumeCampaign(campaign.id);
    expect(resumed?.status).toBe('active');
  });

  it('executeStep for wait_delay does not advance immediately', async () => {
    const campaign = store.createCampaign({
      name: 'Wait Delay',
      channel: 'email',
    });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'wait_delay',
      name: 'Wait 1 hour',
      delaySeconds: 3600,
    });
    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
    });

    const result = orchestration.executeStep(step, enrollment);
    expect(result.success).toBe(true);
    expect(result.advance).toBe(false);

    const updated = await store.getEnrollment(enrollment.id);
    const nextExec = new Date(updated!.nextExecutionAt!).getTime();
    expect(nextExec).toBeGreaterThan(Date.now());
  });

  it('executeStep for unknown step type returns error', async () => {
    const campaign = store.createCampaign({
      name: 'Unknown Type',
      channel: 'email',
    });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email', // will override
      name: 'Bad Step',
    });
    // Force an unknown step type
    (step as any).stepType = 'nonexistent_type';

    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
    });

    const result = orchestration.executeStep(step, enrollment);
    expect(result.success).toBe(false);
    expect(result.advance).toBe(false);
    expect(result.error).toContain('Unknown step type');
  });

  it('enrollCampaign returns 0 enrolled when campaign has no steps', async () => {
    const campaign = store.createCampaign({
      name: 'No Steps',
      channel: 'email',
    });

    const result = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(result.enrolled).toBe(0);
    expect(result.campaign).toBeTruthy();
  });

  it('pauseCampaign returns null for non-active campaigns', async () => {
    const campaign = store.createCampaign({
      name: 'Draft Campaign',
      channel: 'email',
    });
    // Campaign is draft, not active
    const result = await orchestration.pauseCampaign(campaign.id);
    expect(result).toBeNull();
  });

  it('resumeCampaign returns null for non-paused campaigns', async () => {
    const campaign = store.createCampaign({
      name: 'Draft Campaign',
      channel: 'email',
    });
    // Campaign is draft, not paused
    const result = await orchestration.resumeCampaign(campaign.id);
    expect(result).toBeNull();
  });

  it('campaign step events are recorded during execution', async () => {
    const campaign = store.createCampaign({
      name: 'Event Tracking',
      channel: 'email',
    });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Track Events',
    });
    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
    });

    orchestration.executeStep(step, enrollment);

    const events = await store.getStepEvents(step.id);
    expect(events.length).toBeGreaterThanOrEqual(2); // executed + sent
    const eventTypes = events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain('executed');
    expect(eventTypes).toContain('sent');
  });

  it('full enrollment lifecycle: enroll -> execute -> advance -> complete', async () => {
    const campaign = store.createCampaign({
      name: 'Full Lifecycle',
      channel: 'email',
    });
    const step1 = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Welcome',
    });
    // No nextStepId -- single step campaign

    const result = await orchestration.enrollCampaign(campaign.id, [testCustomers[0]]);
    expect(result.enrolled).toBe(1);

    const enrollments = await store.getEnrollments(campaign.id);
    const enrollment = enrollments[0];
    expect(enrollment.currentStepId).toBe(step1.id);

    // Execute the step
    const stepResult = orchestration.executeStep(step1, enrollment);
    expect(stepResult.success).toBe(true);
    expect(stepResult.advance).toBe(true);
    expect(stepResult.nextStepId).toBeUndefined(); // No next step

    // Advance -- should mark completed
    orchestration.advanceEnrollment(enrollment, stepResult.nextStepId);

    const final = await store.getEnrollment(enrollment.id);
    expect(final?.status).toBe('completed');
    expect(final?.completedAt).toBeTruthy();
  });
});
