import { describe, it, expect } from 'vitest';
import {
  encodeBitfield,
  decodeBitfield,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  ALL_PERMISSIONS_BITFIELD,
  parseBitfield,
} from '../bitfield';
import { PERMISSION_KEYS, BUILTIN_ROLE_MATRIX } from '../constants';

const ZERO = BigInt(0);
const ONE = BigInt(1);

describe('bitfield', () => {
  describe('encodeBitfield', () => {
    it('empty array → 0', () => {
      expect(encodeBitfield([])).toBe(ZERO);
    });

    it('single permission → correct bit', () => {
      const bf = encodeBitfield(['tickets:view']); // bit 0
      expect(bf).toBe(ONE);
    });

    it('bit 34 → correct value', () => {
      const bf = encodeBitfield(['time:log']); // bit 34
      expect(bf).toBe(ONE << BigInt(34));
    });

    it('unknown keys are ignored', () => {
      const bf = encodeBitfield(['unknown:key']);
      expect(bf).toBe(ZERO);
    });

    it('all 35 → all bits set', () => {
      const bf = encodeBitfield([...PERMISSION_KEYS]);
      expect(bf).toBe(ALL_PERMISSIONS_BITFIELD);
      // Verify it equals 2^35 - 1
      expect(bf).toBe((ONE << BigInt(35)) - ONE);
    });
  });

  describe('decodeBitfield', () => {
    it('0 → empty array', () => {
      expect(decodeBitfield(ZERO)).toEqual([]);
    });

    it('roundtrips with encode', () => {
      const keys = ['tickets:view', 'kb:edit', 'admin:billing'];
      const bf = encodeBitfield(keys);
      const decoded = decodeBitfield(bf);
      expect(decoded.sort()).toEqual(keys.sort());
    });

    it('roundtrips all 35 permissions', () => {
      const decoded = decodeBitfield(ALL_PERMISSIONS_BITFIELD);
      expect(decoded).toHaveLength(35);
      expect(decoded.sort()).toEqual([...PERMISSION_KEYS].sort());
    });
  });

  describe('hasPermission', () => {
    it('returns true for set bit', () => {
      const bf = encodeBitfield(['tickets:view', 'kb:edit']);
      expect(hasPermission(bf, 'tickets:view')).toBe(true);
      expect(hasPermission(bf, 'kb:edit')).toBe(true);
    });

    it('returns false for unset bit', () => {
      const bf = encodeBitfield(['tickets:view']);
      expect(hasPermission(bf, 'kb:edit')).toBe(false);
    });

    it('returns false for unknown key', () => {
      expect(hasPermission(ALL_PERMISSIONS_BITFIELD, 'unknown:key')).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true if any match', () => {
      const bf = encodeBitfield(['tickets:view']);
      expect(hasAnyPermission(bf, ['tickets:view', 'kb:edit'])).toBe(true);
    });

    it('returns false if none match', () => {
      const bf = encodeBitfield(['tickets:view']);
      expect(hasAnyPermission(bf, ['kb:edit', 'admin:billing'])).toBe(false);
    });

    it('returns false for empty keys', () => {
      expect(hasAnyPermission(ALL_PERMISSIONS_BITFIELD, [])).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true if all match', () => {
      const bf = encodeBitfield(['tickets:view', 'kb:edit', 'admin:billing']);
      expect(hasAllPermissions(bf, ['tickets:view', 'kb:edit'])).toBe(true);
    });

    it('returns false if one missing', () => {
      const bf = encodeBitfield(['tickets:view']);
      expect(hasAllPermissions(bf, ['tickets:view', 'kb:edit'])).toBe(false);
    });

    it('returns true for empty keys', () => {
      expect(hasAllPermissions(ZERO, [])).toBe(true);
    });
  });

  describe('parseBitfield', () => {
    it('parses valid decimal string', () => {
      expect(parseBitfield('42')).toBe(BigInt(42));
    });

    it('returns 0 for null/undefined/empty', () => {
      expect(parseBitfield(null)).toBe(ZERO);
      expect(parseBitfield(undefined)).toBe(ZERO);
      expect(parseBitfield('')).toBe(ZERO);
    });

    it('returns 0 for invalid string', () => {
      expect(parseBitfield('not-a-number')).toBe(ZERO);
    });

    it('rejects negative values (prevents -1 bypass)', () => {
      expect(parseBitfield('-1')).toBe(ZERO);
      expect(parseBitfield('-2')).toBe(ZERO);
    });

    it('rejects values exceeding max bitfield', () => {
      // 2^36 is beyond the defined permissions
      const tooLarge = (ONE << BigInt(36)).toString();
      expect(parseBitfield(tooLarge)).toBe(ZERO);
    });

    it('roundtrips ALL_PERMISSIONS_BITFIELD', () => {
      const s = ALL_PERMISSIONS_BITFIELD.toString();
      expect(parseBitfield(s)).toBe(ALL_PERMISSIONS_BITFIELD);
    });
  });

  describe('role matrix bitfields', () => {
    it('owner bitfield equals ALL_PERMISSIONS_BITFIELD', () => {
      const bf = encodeBitfield([...BUILTIN_ROLE_MATRIX.owner]);
      expect(bf).toBe(ALL_PERMISSIONS_BITFIELD);
    });

    it('light_agent cannot reply publicly', () => {
      const bf = encodeBitfield([...BUILTIN_ROLE_MATRIX.light_agent]);
      expect(hasPermission(bf, 'tickets:reply_public')).toBe(false);
      expect(hasPermission(bf, 'tickets:reply_internal')).toBe(true);
    });

    it('collaborator has only 2 permissions', () => {
      const bf = encodeBitfield([...BUILTIN_ROLE_MATRIX.collaborator]);
      const decoded = decodeBitfield(bf);
      expect(decoded).toHaveLength(2);
    });

    it('viewer cannot edit anything', () => {
      const bf = encodeBitfield([...BUILTIN_ROLE_MATRIX.viewer]);
      expect(hasPermission(bf, 'kb:edit')).toBe(false);
      expect(hasPermission(bf, 'tickets:create')).toBe(false);
      expect(hasPermission(bf, 'admin:users')).toBe(false);
    });
  });
});
