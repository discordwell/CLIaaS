import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateApiKey, validateApiKey } from '@/lib/api-keys';

// ---- Mock DB layer for validateApiKey ----
// The select chain resolves to `selectRows`; each test configures it.
let selectRows: unknown[] = [];
const mockLimit = vi.fn(async () => selectRows);
const mockSelect = vi.fn(() => ({
  from: () => ({
    innerJoin: () => ({
      where: () => ({ limit: mockLimit }),
    }),
  }),
}));
const mockUpdateWhere = vi.fn(async () => []);
const mockUpdate = vi.fn(() => ({
  set: () => ({ where: mockUpdateWhere }),
}));

vi.mock('@/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...(args as [])),
    update: (...args: unknown[]) => mockUpdate(...(args as [])),
  },
}));

vi.mock('@/db/schema', () => ({
  apiKeys: {
    id: 'id',
    workspaceId: 'workspaceId',
    keyHash: 'keyHash',
    prefix: 'prefix',
    scopes: 'scopes',
    lastUsedAt: 'lastUsedAt',
    expiresAt: 'expiresAt',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    revokedAt: 'revokedAt',
    name: 'name',
  },
  users: {
    id: 'id',
    name: 'name',
    email: 'email',
    role: 'role',
    status: 'status',
    tenantId: 'tenantId',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

/** A live key row joined to an active admin user, overridable per test. */
function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    workspaceId: 'ws-1',
    scopes: ['tickets:read'],
    expiresAt: null,
    revokedAt: null,
    createdBy: 'user-1',
    userName: 'Alice',
    userEmail: 'alice@example.com',
    userRole: 'admin',
    userStatus: 'active',
    userTenantId: 'tenant-1',
    ...overrides,
  };
}

describe('API keys service', () => {
  describe('generateApiKey', () => {
    it('generates a key with cliaas_ prefix', () => {
      const { rawKey, keyHash, prefix } = generateApiKey();
      expect(rawKey).toMatch(/^cliaas_[a-f0-9]{8}_[a-f0-9]+$/);
      expect(prefix).toMatch(/^cliaas_[a-f0-9]{8}$/);
      expect(keyHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    it('generates unique keys each time', () => {
      const k1 = generateApiKey();
      const k2 = generateApiKey();
      expect(k1.rawKey).not.toBe(k2.rawKey);
      expect(k1.keyHash).not.toBe(k2.keyHash);
    });

    it('produces deterministic hash from key', () => {
      const { rawKey, keyHash } = generateApiKey();
      // Verify by hashing again
      const crypto = require('crypto');
      const reHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      expect(reHash).toBe(keyHash);
    });

    it('prefix matches the beginning of the raw key', () => {
      const { rawKey, prefix } = generateApiKey();
      expect(rawKey.startsWith(prefix)).toBe(true);
    });
  });

  describe('validateApiKey', () => {
    const RAW_KEY = generateApiKey().rawKey;

    beforeEach(() => {
      selectRows = [];
      mockSelect.mockClear();
      mockUpdate.mockClear();
      mockLimit.mockClear();
    });

    it('returns the AuthUser (with tenantId) for a live key of an active user', async () => {
      selectRows = [keyRow()];
      const user = await validateApiKey(RAW_KEY);
      expect(user).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        role: 'admin',
        workspaceId: 'ws-1',
        tenantId: 'tenant-1',
        authType: 'api-key',
        scopes: ['tickets:read'],
      });
    });

    it('carries tenantId so billing/seat-limit routes see the same identity as session auth', async () => {
      // Regression: the API-key path omitted tenantId while session JWTs carry
      // it, so routes gating on user.tenantId (users/invite seat check,
      // billing) silently skipped enforcement for API-key requests.
      selectRows = [keyRow({ userTenantId: 'tenant-42' })];
      const user = await validateApiKey(RAW_KEY);
      expect(user?.tenantId).toBe('tenant-42');
    });

    it('maps a null tenant to undefined, not null', async () => {
      selectRows = [keyRow({ userTenantId: null })];
      const user = await validateApiKey(RAW_KEY);
      expect(user).not.toBeNull();
      expect(user?.tenantId).toBeUndefined();
    });

    it("rejects a disabled user's key (admin offboarding)", async () => {
      // Regression: sign-in blocks status !== 'active', but API keys never
      // checked user status — an offboarded employee's keys kept working.
      selectRows = [keyRow({ userStatus: 'disabled' })];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it("rejects an inactive user's key (SCIM deprovisioning)", async () => {
      selectRows = [keyRow({ userStatus: 'inactive' })];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it("rejects an invited (not yet activated) user's key", async () => {
      selectRows = [keyRow({ userStatus: 'invited' })];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it('rejects a revoked key', async () => {
      selectRows = [keyRow({ revokedAt: new Date('2026-01-01T00:00:00Z') })];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it('rejects an expired key', async () => {
      selectRows = [keyRow({ expiresAt: new Date('2020-01-01T00:00:00Z') })];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it('accepts a key expiring in the future', async () => {
      selectRows = [keyRow({ expiresAt: new Date(Date.now() + 86_400_000) })];
      expect(await validateApiKey(RAW_KEY)).not.toBeNull();
    });

    it('returns null for an unknown key hash', async () => {
      selectRows = [];
      expect(await validateApiKey(RAW_KEY)).toBeNull();
    });

    it('short-circuits keys without the cliaas_ prefix before touching the DB', async () => {
      expect(await validateApiKey('sk_live_notours')).toBeNull();
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('bumps lastUsedAt on success but not on a rejected key', async () => {
      selectRows = [keyRow()];
      await validateApiKey(RAW_KEY);
      expect(mockUpdate).toHaveBeenCalledTimes(1);

      mockUpdate.mockClear();
      selectRows = [keyRow({ userStatus: 'disabled' })];
      await validateApiKey(RAW_KEY);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
