import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Billing API routes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // -- GET /api/billing --

  describe('GET /api/billing', () => {
    it('returns plan data in demo mode', async () => {
      const { GET } = await import('@/app/api/billing/route');
      const req = new NextRequest('http://localhost:3000/api/billing');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('plan');
      expect(body).toHaveProperty('planName');
      expect(body).toHaveProperty('quotas');
      expect(body).toHaveProperty('usage');
      expect(body.subscription).toBeNull();
    });

    it('returns byoc plan in demo mode', async () => {
      const { GET } = await import('@/app/api/billing/route');
      const req = new NextRequest('http://localhost:3000/api/billing');
      const res = await GET(req);
      const body = await res.json();
      expect(body.plan).toBe('byoc');
      expect(body.price).toBe(0);
    });

    it('returns stripeConfigured: false when STRIPE_SECRET_KEY is not set', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      vi.resetModules();
      const { GET } = await import('@/app/api/billing/route');
      const req = new NextRequest('http://localhost:3000/api/billing');
      const res = await GET(req);
      const body = await res.json();
      expect(body.stripeConfigured).toBe(false);
    });

    it('returns stripeConfigured: true when STRIPE_SECRET_KEY is set', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
      vi.resetModules();
      const { GET } = await import('@/app/api/billing/route');
      const req = new NextRequest('http://localhost:3000/api/billing');
      const res = await GET(req);
      const body = await res.json();
      expect(body.stripeConfigured).toBe(true);
    });
  });

  // -- POST /api/billing/checkout --

  describe('POST /api/billing/checkout', () => {
    it('returns 503 when Stripe is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { POST } = await import('@/app/api/billing/checkout/route');
      const req = new NextRequest('http://localhost:3000/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro_hosted' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/stripe/i);
    });

    it('returns 400 when plan is missing or invalid', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
      vi.resetModules();
      const { POST } = await import('@/app/api/billing/checkout/route');
      const req = new NextRequest('http://localhost:3000/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/plan/i);
    });

    it('rejects invalid plan names', async () => {
      const { POST } = await import('@/app/api/billing/checkout/route');
      const req = new NextRequest('http://localhost:3000/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'hackerplan' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // -- POST /api/billing/portal --

  describe('POST /api/billing/portal', () => {
    it('returns 503 when Stripe is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { POST } = await import('@/app/api/billing/portal/route');
      const req = new NextRequest('http://localhost:3000/api/billing/portal', {
        method: 'POST',
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/stripe/i);
    });
  });

  // -- POST /api/stripe/webhook --

  describe('POST /api/stripe/webhook', () => {
    it('returns 503 when Stripe is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const { POST } = await import('@/app/api/stripe/webhook/route');
      const req = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test_sig' },
        body: '{}',
      });
      const res = await POST(req);
      expect(res.status).toBe(503);
    });

    it('returns 400 when stripe-signature header is missing', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
      vi.resetModules();
      const { POST } = await import('@/app/api/stripe/webhook/route');
      const req = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        body: '{}',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/stripe-signature/i);
    });

    it('returns 400 for invalid signature', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
      vi.resetModules();
      const { POST } = await import('@/app/api/stripe/webhook/route');
      const req = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'v1=invalid_signature' },
        body: '{"type":"test"}',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/webhook/i);
    });
  });

  // -- Quota enforcement --

  describe('Quota enforcement (demo mode)', () => {
    it('ticket creation passes in demo mode (no quota block)', async () => {
      const { checkQuota } = await import('@/lib/billing/usage');
      const result = await checkQuota('any-tenant', 'ticket');
      expect(result.allowed).toBe(true);
    });

    it('AI call quota passes in demo mode', async () => {
      const { checkQuota } = await import('@/lib/billing/usage');
      const result = await checkQuota('any-tenant', 'ai_call');
      expect(result.allowed).toBe(true);
    });

    it('API request quota passes in demo mode', async () => {
      const { checkQuota } = await import('@/lib/billing/usage');
      const result = await checkQuota('any-tenant', 'api_request');
      expect(result.allowed).toBe(true);
    });
  });
});
