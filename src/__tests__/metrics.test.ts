import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Prometheus Metrics Registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('registry returns valid Prometheus text format', async () => {
    const { registry } = await import('@/lib/metrics');
    const output = await registry.metrics();
    expect(typeof output).toBe('string');
    // Default metrics include process_cpu_seconds_total
    expect(output).toContain('process_cpu');
  });

  it('httpRequestDuration histogram works', async () => {
    const { httpRequestDuration, registry } = await import('@/lib/metrics');
    httpRequestDuration.observe({ method: 'GET', route: '/api/test', status_code: '200' }, 0.05);
    const output = await registry.metrics();
    expect(output).toContain('http_request_duration_seconds');
  });

  it('httpRequestsTotal counter works', async () => {
    const { httpRequestsTotal, registry } = await import('@/lib/metrics');
    httpRequestsTotal.inc({ method: 'GET', route: '/api/test', status_code: '200' });
    const output = await registry.metrics();
    expect(output).toContain('http_requests_total');
  });

  it('appErrorsTotal counter works', async () => {
    const { appErrorsTotal, registry } = await import('@/lib/metrics');
    appErrorsTotal.inc({ module: 'test', type: 'error' });
    const output = await registry.metrics();
    expect(output).toContain('app_errors_total');
  });
});

describe('/api/metrics endpoint', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns 200 with Prometheus content type', async () => {
    const { GET } = await import('@/app/api/metrics/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('process_cpu');
  });
});
