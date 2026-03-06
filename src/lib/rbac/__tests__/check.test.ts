import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encodeBitfield } from '../bitfield';
import { requirePermission, requireAnyPermission } from '../check';

// Helper to create a mock request with headers
function mockRequest(headers: Record<string, string> = {}): Request {
  const h = new Headers();
  // Default: authenticated user
  h.set('x-user-id', 'user-1');
  h.set('x-workspace-id', 'ws-1');
  h.set('x-user-role', 'agent');
  h.set('x-user-email', 'test@example.com');
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v);
  }
  return new Request('http://localhost/api/test', { headers: h });
}

describe('requirePermission', () => {
  const origRbac = process.env.RBAC_ENABLED;
  const origDb = process.env.DATABASE_URL;

  beforeEach(() => {
    // Ensure demo mode for getAuthUser
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (origRbac === undefined) delete process.env.RBAC_ENABLED;
    else process.env.RBAC_ENABLED = origRbac;
    if (origDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = origDb;
  });

  it('passes when RBAC is disabled (legacy behaviour)', async () => {
    delete process.env.RBAC_ENABLED;
    const result = await requirePermission(mockRequest(), 'admin:billing');
    expect('user' in result).toBe(true);
  });

  it('denies when RBAC enabled, no bitfield, and role lacks permission (default-deny)', async () => {
    process.env.RBAC_ENABLED = '1';
    // agent role does not have admin:billing → should deny
    const result = await requirePermission(mockRequest(), 'admin:billing');
    expect('error' in result).toBe(true);
  });

  it('passes when RBAC enabled, no bitfield, but role has the permission', async () => {
    process.env.RBAC_ENABLED = '1';
    // agent role has tickets:view → should pass via role-based fallback
    const result = await requirePermission(mockRequest(), 'tickets:view');
    expect('user' in result).toBe(true);
  });

  it('passes when RBAC enabled and user has the permission', async () => {
    process.env.RBAC_ENABLED = '1';
    const bf = encodeBitfield(['tickets:view', 'admin:billing']);
    const req = mockRequest({ 'x-user-permissions': bf.toString() });
    const result = await requirePermission(req, 'admin:billing');
    expect('user' in result).toBe(true);
  });

  it('denies when RBAC enabled and user lacks the permission', async () => {
    process.env.RBAC_ENABLED = '1';
    const bf = encodeBitfield(['tickets:view']);
    const req = mockRequest({ 'x-user-permissions': bf.toString() });
    const result = await requirePermission(req, 'admin:billing');
    expect('error' in result).toBe(true);
  });
});

describe('requireAnyPermission', () => {
  const origRbac = process.env.RBAC_ENABLED;
  const origDb = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (origRbac === undefined) delete process.env.RBAC_ENABLED;
    else process.env.RBAC_ENABLED = origRbac;
    if (origDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = origDb;
  });

  it('passes when user has any one of the required permissions', async () => {
    process.env.RBAC_ENABLED = '1';
    const bf = encodeBitfield(['tickets:view']);
    const req = mockRequest({ 'x-user-permissions': bf.toString() });
    const result = await requireAnyPermission(req, ['tickets:view', 'admin:billing']);
    expect('user' in result).toBe(true);
  });

  it('denies when user has none of the required permissions', async () => {
    process.env.RBAC_ENABLED = '1';
    const bf = encodeBitfield(['kb:view']);
    const req = mockRequest({ 'x-user-permissions': bf.toString() });
    const result = await requireAnyPermission(req, ['tickets:view', 'admin:billing']);
    expect('error' in result).toBe(true);
  });
});
