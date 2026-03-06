/**
 * Permission bitfield encoding/decoding.
 *
 * Each of the 35 permissions is assigned a stable bit index (0-34).
 * A user's effective permissions are encoded as a single BigInt,
 * stored in the JWT as a decimal string in the `p` claim.
 *
 * This gives O(1) permission checks with ~10 bytes in the JWT.
 */

import { BIT_INDEX_MAP, PERMISSION_KEYS } from './constants';

const ZERO = BigInt(0);
const ONE = BigInt(1);

/** Encode a set of permission keys into a BigInt bitfield. */
export function encodeBitfield(permissionKeys: string[]): bigint {
  let bits = ZERO;
  for (const key of permissionKeys) {
    const idx = BIT_INDEX_MAP[key];
    if (idx !== undefined) {
      bits |= ONE << BigInt(idx);
    }
  }
  return bits;
}

/** Decode a BigInt bitfield back to an array of permission keys. */
export function decodeBitfield(bitfield: bigint): string[] {
  const keys: string[] = [];
  for (const key of PERMISSION_KEYS) {
    const idx = BIT_INDEX_MAP[key];
    if ((bitfield & (ONE << BigInt(idx))) !== ZERO) {
      keys.push(key);
    }
  }
  return keys;
}

/** Check if a bitfield includes a specific permission. */
export function hasPermission(bitfield: bigint, permissionKey: string): boolean {
  const idx = BIT_INDEX_MAP[permissionKey];
  if (idx === undefined) return false;
  return (bitfield & (ONE << BigInt(idx))) !== ZERO;
}

/** Check if a bitfield includes ANY of the given permissions. */
export function hasAnyPermission(bitfield: bigint, keys: string[]): boolean {
  for (const key of keys) {
    if (hasPermission(bitfield, key)) return true;
  }
  return false;
}

/** Check if a bitfield includes ALL of the given permissions. */
export function hasAllPermissions(bitfield: bigint, keys: string[]): boolean {
  for (const key of keys) {
    if (!hasPermission(bitfield, key)) return false;
  }
  return true;
}

/** BigInt bitfield with all 35 bits set (used for owner / demo). */
export const ALL_PERMISSIONS_BITFIELD = encodeBitfield([...PERMISSION_KEYS]);

/** Maximum valid bitfield value (all defined permission bits set). */
const MAX_BITFIELD = (ONE << BigInt(PERMISSION_KEYS.length)) - ONE;

/** Parse a bitfield from its decimal string representation (as stored in JWT). */
export function parseBitfield(s: string | undefined | null): bigint {
  if (!s) return ZERO;
  try {
    const v = BigInt(s);
    if (v < ZERO || v > MAX_BITFIELD) return ZERO;
    return v;
  } catch {
    return ZERO;
  }
}
