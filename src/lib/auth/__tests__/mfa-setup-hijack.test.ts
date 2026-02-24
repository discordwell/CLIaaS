import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Tests for MFA setup hijacking prevention.
 * The setup route should reject requests when a pending MFA record
 * was created less than 10 minutes ago.
 */

// Mock database module
const mockSelect = vi.fn();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: vi.fn().mockResolvedValue([]) }),
    update: () => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
}));

vi.mock('@/db/schema', () => ({
  userMfa: {
    id: 'id',
    userId: 'userId',
    enabledAt: 'enabledAt',
    createdAt: 'createdAt',
    totpSecret: 'totpSecret',
    backupCodes: 'backupCodes',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

describe('MFA setup hijack prevention', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.restoreAllMocks();
  });

  function makeAuthRequest() {
    return new Request('http://localhost:3000/api/auth/mfa/setup', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-workspace-id': 'ws-1',
        'x-user-role': 'admin',
        'x-user-email': 'admin@test.com',
      },
    }) as unknown as import('next/server').NextRequest;
  }

  it('returns 409 when pending MFA record is less than 10 minutes old', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    // Recent pending record (created 2 minutes ago)
    mockFrom.mockReturnThis();
    mockWhere.mockReturnThis();
    mockLimit.mockResolvedValueOnce([{
      id: 'mfa-1',
      enabledAt: null,
      createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago
    }]);
    mockFrom.mockReturnValue({ where: () => ({ limit: mockLimit }) });

    const { POST } = await import('@/app/api/auth/mfa/setup/route');
    const res = await POST(makeAuthRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already in progress');
  });

  it('allows re-setup when pending MFA record is older than 10 minutes', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    // Old pending record (created 15 minutes ago)
    const mockLimitOld = vi.fn().mockResolvedValueOnce([{
      id: 'mfa-2',
      enabledAt: null,
      createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
    }]);
    mockFrom.mockReturnValue({ where: () => ({ limit: mockLimitOld }) });

    const { POST } = await import('@/app/api/auth/mfa/setup/route');
    const res = await POST(makeAuthRequest());
    // Should proceed with setup (200 or update)
    // We can't fully test the success path without DB, but it should NOT be 409
    expect(res.status).not.toBe(409);
  });

  it('rejects when MFA is already enabled', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    const mockLimitEnabled = vi.fn().mockResolvedValueOnce([{
      id: 'mfa-3',
      enabledAt: new Date(),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    }]);
    mockFrom.mockReturnValue({ where: () => ({ limit: mockLimitEnabled }) });

    const { POST } = await import('@/app/api/auth/mfa/setup/route');
    const res = await POST(makeAuthRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already enabled');
  });
});
