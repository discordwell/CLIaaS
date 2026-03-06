"use client";

import type { ReactNode } from "react";
import { usePermissions } from "./PermissionProvider";

interface PermissionGateProps {
  /** Single permission key required. */
  permission?: string;
  /** Multiple permission keys — user needs ANY of them. */
  permissions?: string[];
  /** Rendered when the user lacks the required permission(s). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only if the current user has the required permission(s).
 * When loading, renders nothing.
 * When RBAC is not active, renders children (allow-all fallback).
 */
export default function PermissionGate({
  permission,
  permissions: permissionList,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { rbacActive, loading, hasPermission } = usePermissions();

  if (loading) return null;

  // RBAC not active — allow everything
  if (!rbacActive) return <>{children}</>;

  // Check single permission
  if (permission && hasPermission(permission)) {
    return <>{children}</>;
  }

  // Check any-of permission list
  if (permissionList && permissionList.length > 0) {
    const hasAny = permissionList.some((key) => hasPermission(key));
    if (hasAny) return <>{children}</>;
  }

  // Neither single nor list provided — render children (no restriction)
  if (!permission && (!permissionList || permissionList.length === 0)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
