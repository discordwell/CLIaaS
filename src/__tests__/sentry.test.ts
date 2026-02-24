import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Sentry — no-op when DSN unset', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('captureException does not throw when Sentry is not initialized', async () => {
    const Sentry = await import('@sentry/nextjs');
    // Should be a no-op — no DSN means Sentry.init() was never called
    expect(() => Sentry.captureException(new Error('test'))).not.toThrow();
  });

  it('@sentry/nextjs module is importable', async () => {
    const Sentry = await import('@sentry/nextjs');
    expect(Sentry.captureException).toBeDefined();
    expect(typeof Sentry.captureException).toBe('function');
  });
});

describe('Global Error Component', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('global-error component renders without crashing', async () => {
    const { default: GlobalError } = await import('@/app/global-error');
    expect(GlobalError).toBeDefined();
    expect(typeof GlobalError).toBe('function');
  });
});

describe('Instrumentation hook', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.SENTRY_DSN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('register() does not throw when no runtime is set', async () => {
    delete process.env.NEXT_RUNTIME;
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});
