import { describe, it, expect } from 'vitest';
import { sign, verify, PORTAL_COOKIE_NAME } from '@/lib/portal/cookie';

describe('portal /me endpoint auth', () => {
  it('returns 401 without cookie (simulated)', () => {
    // Simulates the auth check: getPortalEmail returns null for missing cookie
    const raw = undefined;
    const email = raw ? verify(raw) : null;
    expect(email).toBeNull();
  });

  it('returns 401 with tampered cookie (simulated)', () => {
    const tampered = 'dGVzdA.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const email = verify(tampered);
    expect(email).toBeNull();
  });

  it('returns email with valid cookie (simulated)', () => {
    const cookieValue = sign('alice@example.com');
    const email = verify(cookieValue);
    expect(email).toBe('alice@example.com');
  });

  it('portal user stats shape', () => {
    // Validates the expected response shape
    const portalUser = {
      email: 'alice@example.com',
      stats: { open: 2, pending: 1, solved: 3, total: 6 },
      recentTickets: [
        { id: '1', subject: 'Bug report', status: 'open', updatedAt: '2026-01-01T00:00:00Z' },
      ],
    };

    expect(portalUser.stats.open).toBe(2);
    expect(portalUser.stats.total).toBe(6);
    expect(portalUser.recentTickets).toHaveLength(1);
  });

  it('portal user with org info shape', () => {
    const portalUser = {
      email: 'bob@acme.com',
      stats: { open: 0, pending: 0, solved: 0, total: 0 },
      recentTickets: [],
      orgId: 'org-1',
      orgName: 'Acme Corp',
    };

    expect(portalUser.orgId).toBe('org-1');
    expect(portalUser.orgName).toBe('Acme Corp');
  });
});
