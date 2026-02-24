import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('BYOC mode detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns BYOC mode when CLIAAS_MODE=local', async () => {
    process.env.CLIAAS_MODE = 'local';
    delete process.env.DATABASE_URL;

    // Import the detectDataMode function which uses the same detection logic
    const { detectDataMode } = await import('@/lib/data-provider/index');
    expect(detectDataMode()).toBe('local');
  });

  it('returns db mode when DATABASE_URL is set without explicit CLIAAS_MODE', async () => {
    delete process.env.CLIAAS_MODE;
    process.env.DATABASE_URL = 'postgresql://localhost/cliaas';

    const { detectDataMode } = await import('@/lib/data-provider/index');
    expect(detectDataMode()).toBe('db');
  });

  it('CLIAAS_MODE=local takes precedence over DATABASE_URL', async () => {
    process.env.CLIAAS_MODE = 'local';
    process.env.DATABASE_URL = 'postgresql://localhost/cliaas';

    const { detectDataMode } = await import('@/lib/data-provider/index');
    expect(detectDataMode()).toBe('local');
  });

  it('returns local when nothing is configured', async () => {
    delete process.env.CLIAAS_MODE;
    delete process.env.DATABASE_URL;

    const { detectDataMode } = await import('@/lib/data-provider/index');
    expect(detectDataMode()).toBe('local');
  });
});
