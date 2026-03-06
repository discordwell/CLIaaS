import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('isRbacEnabled', () => {
  const origEnv = process.env.RBAC_ENABLED;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.RBAC_ENABLED;
    else process.env.RBAC_ENABLED = origEnv;
  });

  async function loadFresh() {
    // Re-import to get fresh module (env read is at call-time, not import-time)
    const { isRbacEnabled } = await import('../feature-flag');
    return isRbacEnabled;
  }

  it('defaults to false when RBAC_ENABLED is unset', async () => {
    delete process.env.RBAC_ENABLED;
    const fn = await loadFresh();
    expect(fn()).toBe(false);
  });

  it('returns true for RBAC_ENABLED=1', async () => {
    process.env.RBAC_ENABLED = '1';
    const fn = await loadFresh();
    expect(fn()).toBe(true);
  });

  it('returns true for RBAC_ENABLED=true', async () => {
    process.env.RBAC_ENABLED = 'true';
    const fn = await loadFresh();
    expect(fn()).toBe(true);
  });

  it('returns false for RBAC_ENABLED=0', async () => {
    process.env.RBAC_ENABLED = '0';
    const fn = await loadFresh();
    expect(fn()).toBe(false);
  });

  it('returns false for RBAC_ENABLED=false', async () => {
    process.env.RBAC_ENABLED = 'false';
    const fn = await loadFresh();
    expect(fn()).toBe(false);
  });

  it('returns false for random string', async () => {
    process.env.RBAC_ENABLED = 'yes';
    const fn = await loadFresh();
    expect(fn()).toBe(false);
  });
});
