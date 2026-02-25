import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPostRequest, buildAuthHeaders, TEST_USER } from './helpers';

function authHeadersWithTenant() {
  return {
    ...buildAuthHeaders(TEST_USER),
    'x-tenant-id': TEST_USER.tenantId,
  };
}

describe('POST /api/onboarding/seed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 401 without auth', async () => {
    process.env.DATABASE_URL = 'postgres://fake';

    const { POST } = await import('@/app/api/onboarding/seed/route');
    const req = buildPostRequest('/api/onboarding/seed', {});
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 503 when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;

    const { POST } = await import('@/app/api/onboarding/seed/route');
    const req = buildPostRequest('/api/onboarding/seed', {}, {
      headers: authHeadersWithTenant(),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it('returns 200 and seeds data when authenticated', async () => {
    process.env.DATABASE_URL = 'postgres://fake';

    vi.doMock('@/lib/onboarding/seed-sample-data', () => ({
      seedWorkspaceWithSampleData: vi.fn().mockResolvedValue(undefined),
    }));

    const { POST } = await import('@/app/api/onboarding/seed/route');
    const req = buildPostRequest('/api/onboarding/seed', {}, {
      headers: authHeadersWithTenant(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('returns 500 when seed fails', async () => {
    process.env.DATABASE_URL = 'postgres://fake';

    vi.doMock('@/lib/onboarding/seed-sample-data', () => ({
      seedWorkspaceWithSampleData: vi.fn().mockRejectedValue(new Error('DB error')),
    }));

    const { POST } = await import('@/app/api/onboarding/seed/route');
    const req = buildPostRequest('/api/onboarding/seed', {}, {
      headers: authHeadersWithTenant(),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('DB error');
  });
});
