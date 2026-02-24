import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('GET /api/health', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 200 status', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns JSON with status ok in demo mode', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('cliaas');
  });

  it('includes a valid ISO timestamp', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    const parsed = new Date(body.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('includes checks object', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toBeDefined();
    expect(body.checks.redis).toBeDefined();
    expect(body.checks.queues).toBeDefined();
  });

  it('reports not_configured for DB and Redis when unset', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();
    expect(body.checks.database.status).toBe('not_configured');
    expect(body.checks.redis.status).toBe('not_configured');
    // Overall status is ok when nothing is configured (demo mode)
    expect(body.status).toBe('ok');
  });
});
