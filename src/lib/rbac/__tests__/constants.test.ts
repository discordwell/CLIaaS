import { describe, it, expect } from 'vitest';
import {
  PERMISSION_KEYS,
  BIT_INDEX_MAP,
  BUILTIN_ROLE_MATRIX,
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
} from '../constants';

describe('RBAC constants', () => {
  it('has exactly 35 permission keys', () => {
    expect(PERMISSION_KEYS).toHaveLength(35);
  });

  it('has no duplicate permission keys', () => {
    const unique = new Set(PERMISSION_KEYS);
    expect(unique.size).toBe(PERMISSION_KEYS.length);
  });

  it('bit indices are sequential 0..34', () => {
    const indices = Object.values(BIT_INDEX_MAP).sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: 35 }, (_, i) => i));
  });

  it('BIT_INDEX_MAP matches array position', () => {
    for (let i = 0; i < PERMISSION_KEYS.length; i++) {
      expect(BIT_INDEX_MAP[PERMISSION_KEYS[i]]).toBe(i);
    }
  });

  it('every permission has a category', () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_CATEGORIES[key]).toBeTruthy();
    }
  });

  it('every permission has a label', () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_LABELS[key]).toBeTruthy();
    }
  });

  describe('built-in role matrix', () => {
    it('owner has all 35 permissions', () => {
      expect(BUILTIN_ROLE_MATRIX.owner).toHaveLength(35);
    });

    it('admin has 34 permissions (all except admin:billing)', () => {
      expect(BUILTIN_ROLE_MATRIX.admin).toHaveLength(34);
      expect(BUILTIN_ROLE_MATRIX.admin).not.toContain('admin:billing');
    });

    it('agent has 22 permissions', () => {
      expect(BUILTIN_ROLE_MATRIX.agent).toHaveLength(22);
      expect(BUILTIN_ROLE_MATRIX.agent).toContain('tickets:view');
      expect(BUILTIN_ROLE_MATRIX.agent).toContain('tickets:reply_public');
      expect(BUILTIN_ROLE_MATRIX.agent).not.toContain('tickets:delete');
      expect(BUILTIN_ROLE_MATRIX.agent).not.toContain('admin:users');
    });

    it('light_agent has 5 permissions', () => {
      expect(BUILTIN_ROLE_MATRIX.light_agent).toHaveLength(5);
      expect(BUILTIN_ROLE_MATRIX.light_agent).toContain('tickets:view');
      expect(BUILTIN_ROLE_MATRIX.light_agent).toContain('tickets:reply_internal');
      expect(BUILTIN_ROLE_MATRIX.light_agent).not.toContain('tickets:reply_public');
      expect(BUILTIN_ROLE_MATRIX.light_agent).not.toContain('tickets:create');
    });

    it('collaborator has 2 permissions', () => {
      expect(BUILTIN_ROLE_MATRIX.collaborator).toHaveLength(2);
      expect(BUILTIN_ROLE_MATRIX.collaborator).toContain('tickets:view');
      expect(BUILTIN_ROLE_MATRIX.collaborator).toContain('tickets:reply_internal');
    });

    it('viewer has 3 permissions', () => {
      expect(BUILTIN_ROLE_MATRIX.viewer).toHaveLength(3);
      expect(BUILTIN_ROLE_MATRIX.viewer).toContain('kb:view');
      expect(BUILTIN_ROLE_MATRIX.viewer).toContain('analytics:view');
      expect(BUILTIN_ROLE_MATRIX.viewer).toContain('forums:view');
    });

    it('every role permission key is a valid PERMISSION_KEY', () => {
      const validKeys = new Set<string>(PERMISSION_KEYS);
      for (const [role, perms] of Object.entries(BUILTIN_ROLE_MATRIX)) {
        for (const p of perms) {
          expect(validKeys.has(p), `${role} has invalid perm: ${p}`).toBe(true);
        }
      }
    });

    it('role permissions are subsets of owner', () => {
      const ownerSet = new Set(BUILTIN_ROLE_MATRIX.owner);
      for (const [role, perms] of Object.entries(BUILTIN_ROLE_MATRIX)) {
        if (role === 'owner') continue;
        for (const p of perms) {
          expect(ownerSet.has(p), `${role}.${p} not in owner`).toBe(true);
        }
      }
    });
  });
});
