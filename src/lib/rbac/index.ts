export { isRbacEnabled } from './feature-flag';
export { PERMISSION_KEYS, BIT_INDEX_MAP, BUILTIN_ROLE_MATRIX, PERMISSION_CATEGORIES, PERMISSION_LABELS } from './constants';
export type { PermissionKey } from './constants';
export type { BuiltinRole, Permission, RolePermission, ExpandedRole } from './types';
export {
  encodeBitfield,
  decodeBitfield,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  ALL_PERMISSIONS_BITFIELD,
  parseBitfield,
} from './bitfield';
export { resolveUserPermissions, getUserBitfield } from './permissions';
export { requirePermission, requireAnyPermission, requirePerm } from './check';
