"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  parseBitfield,
  hasPermission as _hasPermission,
} from "@/lib/rbac/bitfield";

interface PermissionContextValue {
  permissions: bigint;
  rbacActive: boolean;
  role: string;
  loading: boolean;
  hasPermission: (key: string) => boolean;
}

const PermissionContext = createContext<PermissionContextValue>({
  permissions: BigInt(0),
  rbacActive: false,
  role: "",
  loading: true,
  hasPermission: () => true, // default: allow (non-RBAC fallback)
});

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<bigint>(BigInt(0));
  const [rbacActive, setRbacActive] = useState(false);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchMe() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (data.user?.role) {
          setRole(data.user.role);
        }
        if (data.permissions) {
          setPermissions(parseBitfield(data.permissions));
          setRbacActive(true);
        }
      } catch {
        // Network error — fall through to allow-all
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMe();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: PermissionContextValue = {
    permissions,
    rbacActive,
    role,
    loading,
    hasPermission: (key: string) => {
      // When RBAC is not active (no permissions in JWT), allow everything
      if (!rbacActive) return true;
      return _hasPermission(permissions, key);
    },
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionContext);
}
