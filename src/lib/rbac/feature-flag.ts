/**
 * RBAC feature flag.
 *
 * When disabled (default), all permission checks fall through to the
 * legacy role-hierarchy behaviour (owner > admin > agent).
 * Set RBAC_ENABLED=1 or RBAC_ENABLED=true to activate the full
 * permission-bitfield system.
 */
export function isRbacEnabled(): boolean {
  const v = process.env.RBAC_ENABLED;
  return v === '1' || v === 'true';
}
