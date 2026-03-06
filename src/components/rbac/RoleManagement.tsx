"use client";

import { useState, useEffect } from "react";

interface RoleSummary {
  role: string;
  permissionCount: number;
  totalPermissions: number;
  isBuiltin: boolean;
}

interface RolePermission {
  key: string;
  label: string;
  category: string;
}

export default function RoleManagement() {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [permissionCache, setPermissionCache] = useState<
    Record<string, RolePermission[]>
  >({});
  const [loadingPerms, setLoadingPerms] = useState(false);

  useEffect(() => {
    async function fetchRoles() {
      try {
        const res = await fetch("/api/roles");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load roles");
        setRoles(data.roles ?? []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load roles");
      } finally {
        setLoading(false);
      }
    }
    fetchRoles();
  }, []);

  async function toggleExpand(role: string) {
    if (expandedRole === role) {
      setExpandedRole(null);
      return;
    }

    setExpandedRole(role);

    // Fetch permissions if not cached
    if (!permissionCache[role]) {
      setLoadingPerms(true);
      try {
        const res = await fetch(`/api/roles/${role}/permissions`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load permissions");
        setPermissionCache((prev) => ({
          ...prev,
          [role]: data.permissions ?? [],
        }));
      } catch {
        // Silently fail — empty permissions will show
      } finally {
        setLoadingPerms(false);
      }
    }
  }

  // Group permissions by category
  function groupByCategory(
    perms: RolePermission[],
  ): Record<string, RolePermission[]> {
    const groups: Record<string, RolePermission[]> = {};
    for (const p of perms) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }

  const ROLE_COLORS: Record<string, string> = {
    owner: "border-purple-300 bg-purple-50",
    admin: "border-blue-300 bg-blue-50",
    agent: "border-zinc-300 bg-zinc-50",
    light_agent: "border-amber-300 bg-amber-50",
    collaborator: "border-teal-300 bg-teal-50",
    viewer: "border-zinc-200 bg-zinc-50",
  };

  const ROLE_TEXT_COLORS: Record<string, string> = {
    owner: "text-purple-800",
    admin: "text-blue-800",
    agent: "text-zinc-800",
    light_agent: "text-amber-800",
    collaborator: "text-teal-800",
    viewer: "text-zinc-600",
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading roles...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-4">
      {roles.map((r) => {
        const isExpanded = expandedRole === r.role;
        const borderColor = ROLE_COLORS[r.role] ?? ROLE_COLORS.agent;
        const textColor = ROLE_TEXT_COLORS[r.role] ?? ROLE_TEXT_COLORS.agent;

        return (
          <div
            key={r.role}
            className={`border-2 ${borderColor} transition-all`}
          >
            <button
              onClick={() => toggleExpand(r.role)}
              className="flex w-full items-center justify-between px-6 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`text-lg font-black uppercase tracking-tight ${textColor}`}
                >
                  {r.role.replace(/_/g, " ")}
                </span>
                {r.isBuiltin && (
                  <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-bold text-zinc-500">
                    built-in
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-zinc-500">
                  {r.permissionCount}/{r.totalPermissions} permissions
                </span>
                <span className="text-sm text-zinc-400">
                  {isExpanded ? "\u25B2" : "\u25BC"}
                </span>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t-2 border-zinc-200 px-6 py-4">
                {loadingPerms ? (
                  <p className="text-sm text-zinc-400">Loading permissions...</p>
                ) : (
                  (() => {
                    const perms = permissionCache[r.role] ?? [];
                    if (perms.length === 0) {
                      return (
                        <p className="text-sm text-zinc-400">
                          No permissions assigned
                        </p>
                      );
                    }

                    const grouped = groupByCategory(perms);
                    return (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(grouped).map(([category, catPerms]) => (
                          <div key={category}>
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                              {category}
                            </h4>
                            <ul className="space-y-1">
                              {catPerms.map((p) => (
                                <li
                                  key={p.key}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <span className="text-emerald-600">
                                    &#10003;
                                  </span>
                                  <span>{p.label}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
