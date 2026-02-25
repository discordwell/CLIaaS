import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module to avoid real DB connections
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

const chainable = (finalValue: unknown) => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(finalValue);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(finalValue);
  return chain;
};

vi.mock('@/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return chainable([]);
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return chainable([]);
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return chainable([]);
    },
  },
}));

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed:password'),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

describe('user-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sanitizeUser', () => {
    it('strips passwordHash from user object', async () => {
      const { sanitizeUser } = await import('@/lib/user-service');
      const user = {
        id: '1',
        tenantId: 't1',
        workspaceId: 'ws1',
        email: 'test@test.com',
        passwordHash: 'secret-hash',
        name: 'Test',
        role: 'agent' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const safe = sanitizeUser(user);
      expect(safe).not.toHaveProperty('passwordHash');
      expect(safe.email).toBe('test@test.com');
      expect(safe.name).toBe('Test');
    });
  });

  describe('updateUser permission checks', () => {
    it('rejects assigning a role higher than actor role', async () => {
      // Mock getUser to return a target
      vi.resetModules();
      vi.doMock('@/db', () => {
        const target = {
          id: 'target-1',
          role: 'agent',
          workspaceId: 'ws1',
        };
        const selectChain: Record<string, unknown> = {};
        selectChain.from = vi.fn().mockReturnValue(selectChain);
        selectChain.where = vi.fn().mockResolvedValue([target]);

        const updateChain: Record<string, unknown> = {};
        updateChain.set = vi.fn().mockReturnValue(updateChain);
        updateChain.where = vi.fn().mockReturnValue(updateChain);
        updateChain.returning = vi.fn().mockResolvedValue([{ ...target, role: 'owner' }]);

        return {
          db: {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn().mockReturnValue(updateChain),
            insert: vi.fn(),
          },
        };
      });
      vi.doMock('@/lib/password', () => ({
        hashPassword: vi.fn(),
        verifyPassword: vi.fn(),
      }));

      const { updateUser } = await import('@/lib/user-service');
      await expect(
        updateUser('target-1', 'ws1', { role: 'owner' }, 'agent'),
      ).rejects.toThrow(/higher than your own/i);
    });

    it('rejects demoting workspace owner', async () => {
      vi.resetModules();
      vi.doMock('@/db', () => {
        const target = {
          id: 'owner-1',
          role: 'owner',
          workspaceId: 'ws1',
        };
        const selectChain: Record<string, unknown> = {};
        selectChain.from = vi.fn().mockReturnValue(selectChain);
        selectChain.where = vi.fn().mockResolvedValue([target]);

        return {
          db: {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn(),
            insert: vi.fn(),
          },
        };
      });
      vi.doMock('@/lib/password', () => ({
        hashPassword: vi.fn(),
        verifyPassword: vi.fn(),
      }));

      const { updateUser } = await import('@/lib/user-service');
      await expect(
        updateUser('owner-1', 'ws1', { role: 'admin' }, 'owner'),
      ).rejects.toThrow(/demote.*owner/i);
    });
  });

  describe('removeUser', () => {
    it('rejects removing yourself', async () => {
      vi.resetModules();
      vi.doMock('@/db', () => {
        const selectChain: Record<string, unknown> = {};
        selectChain.from = vi.fn().mockReturnValue(selectChain);
        selectChain.where = vi.fn().mockResolvedValue([{ id: 'me', role: 'admin' }]);

        return {
          db: {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn(),
            insert: vi.fn(),
          },
        };
      });
      vi.doMock('@/lib/password', () => ({
        hashPassword: vi.fn(),
        verifyPassword: vi.fn(),
      }));

      const { removeUser } = await import('@/lib/user-service');
      await expect(removeUser('me', 'ws1', 'me')).rejects.toThrow(/yourself/i);
    });
  });

  describe('changePassword', () => {
    it('rejects short new passwords', async () => {
      vi.resetModules();
      vi.doMock('@/db', () => {
        const user = {
          id: 'user-1',
          passwordHash: 'salt:hash',
        };
        const selectChain: Record<string, unknown> = {};
        selectChain.from = vi.fn().mockReturnValue(selectChain);
        selectChain.where = vi.fn().mockResolvedValue([user]);

        return {
          db: {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn(),
            insert: vi.fn(),
          },
        };
      });
      vi.doMock('@/lib/password', () => ({
        hashPassword: vi.fn(),
        verifyPassword: vi.fn().mockResolvedValue(true),
      }));

      const { changePassword } = await import('@/lib/user-service');
      await expect(
        changePassword('user-1', 'oldpw', 'short'),
      ).rejects.toThrow(/8 characters/i);
    });
  });
});
