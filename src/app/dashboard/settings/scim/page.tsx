"use client";

import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SCIMUser {
  id: string;
  userName: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  emails?: Array<{ value: string; type?: string; primary?: boolean }>;
  active: boolean;
  meta: { resourceType: string; created: string; lastModified: string };
}

interface SCIMGroup {
  id: string;
  displayName: string;
  members?: Array<{ value: string; display?: string }>;
  meta: { resourceType: string; created: string; lastModified: string };
}

interface SCIMAuditEntry {
  id: string;
  workspaceId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  changes?: unknown;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SCIMAdminPage() {
  const [users, setUsers] = useState<SCIMUser[]>([]);
  const [groups, setGroups] = useState<SCIMGroup[]>([]);
  const [auditLog, setAuditLog] = useState<SCIMAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  /* The SCIM token is read from an env var at build time, or shown as
     "not configured" if absent. The admin page always masks it. */
  const scimBaseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/scim/v2`
      : "/api/scim/v2";

  /* Token is NOT exposed to the client bundle. The admin page fetches it
     from a server-side API endpoint that requires admin auth. */
  const [scimToken, setScimToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const isConfigured = scimToken.length > 0;

  /* ---- Fetch token then SCIM data ---- */

  const fetchData = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);

    const headers: HeadersInit = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    try {
      const [usersRes, groupsRes, auditRes] = await Promise.allSettled([
        fetch("/api/scim/v2/Users", { headers }),
        fetch("/api/scim/v2/Groups", { headers }),
        fetch("/api/scim/audit", { headers }),
      ]);

      if (usersRes.status === "fulfilled" && usersRes.value.ok) {
        const data = await usersRes.value.json();
        setUsers(data.Resources ?? []);
      }

      if (groupsRes.status === "fulfilled" && groupsRes.value.ok) {
        const data = await groupsRes.value.json();
        setGroups(data.Resources ?? []);
      }

      if (auditRes.status === "fulfilled" && auditRes.value.ok) {
        const data = await auditRes.value.json();
        setAuditLog(data.entries ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SCIM data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/settings/scim-token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const token = d?.token ?? "";
        setScimToken(token);
        setTokenLoaded(true);
        return fetchData(token);
      })
      .catch(() => {
        setTokenLoaded(true);
        fetchData("");
      });
  }, [fetchData]);

  /* ---- Token copy ---- */

  function handleCopyToken() {
    if (!scimToken) return;
    navigator.clipboard.writeText(scimToken).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  }

  function maskToken(token: string): string {
    if (!token) return "Not configured";
    if (token.length <= 8) return "****" + token.slice(-2);
    return token.slice(0, 4) + "****" + token.slice(-4);
  }

  /* ---- Render ---- */

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-2 border-line bg-panel p-8">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Provisioning
          </p>
          <h1 className="mt-2 text-3xl font-bold">SCIM Provisioning</h1>
        </div>
        <span
          className={`border-2 border-line px-3 py-1 font-mono text-xs font-bold uppercase ${
            isConfigured
              ? "bg-emerald-100 text-emerald-800"
              : "bg-zinc-200 text-zinc-600"
          }`}
        >
          {isConfigured ? "Configured" : "Not Configured"}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 border-2 border-red-600 bg-red-50 p-4 font-mono text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Endpoint info panel */}
      <section className="mt-8 border-2 border-line bg-panel p-6">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          SCIM Endpoint
        </h2>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Base URL
            </span>
            <code className="border-2 border-line bg-zinc-50 px-3 py-1.5 font-mono text-sm text-foreground">
              {scimBaseUrl}
            </code>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Bearer Token
            </span>
            <code className="border-2 border-line bg-zinc-50 px-3 py-1.5 font-mono text-sm text-foreground">
              {maskToken(scimToken)}
            </code>
            {isConfigured && (
              <button
                onClick={handleCopyToken}
                className="border-2 border-line bg-panel px-4 py-1.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
              >
                {tokenCopied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Loading state */}
      {loading && (
        <div className="mt-8 border-2 border-line bg-panel p-8 text-center font-mono text-sm text-muted">
          Loading SCIM data...
        </div>
      )}

      {!loading && (
        <>
          {/* Provisioned Users */}
          <section className="mt-8 border-2 border-line bg-panel">
            <div className="border-b-2 border-line p-5">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Provisioned Users
                <span className="ml-2 text-foreground">{users.length}</span>
              </h2>
            </div>

            {users.length === 0 ? (
              <div className="p-8 text-center font-mono text-sm text-muted">
                No SCIM users provisioned yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-sm">
                  <thead>
                    <tr className="border-b-2 border-line text-left">
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Name
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Email
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Status
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        External ID
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Last Synced
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-line/50 hover:bg-accent-soft"
                      >
                        <td className="px-5 py-3 font-bold">
                          {u.name?.formatted ?? u.userName}
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {u.emails?.[0]?.value ?? u.userName}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`border-2 border-line px-2 py-0.5 text-[10px] font-bold uppercase ${
                              u.active
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-zinc-200 text-zinc-600"
                            }`}
                          >
                            {u.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {u.id}
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {new Date(u.meta.lastModified).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Provisioned Groups */}
          <section className="mt-8 border-2 border-line bg-panel">
            <div className="border-b-2 border-line p-5">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Provisioned Groups
                <span className="ml-2 text-foreground">{groups.length}</span>
              </h2>
            </div>

            {groups.length === 0 ? (
              <div className="p-8 text-center font-mono text-sm text-muted">
                No SCIM groups provisioned yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-sm">
                  <thead>
                    <tr className="border-b-2 border-line text-left">
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Group Name
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Members
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Last Synced
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr
                        key={g.id}
                        className="border-b border-line/50 hover:bg-accent-soft"
                      >
                        <td className="px-5 py-3 font-bold">
                          {g.displayName}
                        </td>
                        <td className="px-5 py-3">
                          <span className="border-2 border-line bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase text-foreground">
                            {g.members?.length ?? 0}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {new Date(g.meta.lastModified).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Audit Log */}
          <section className="mt-8 border-2 border-line bg-panel">
            <div className="border-b-2 border-line p-5">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Audit Log
                <span className="ml-2 text-foreground">{auditLog.length}</span>
              </h2>
            </div>

            {auditLog.length === 0 ? (
              <div className="p-8 text-center font-mono text-sm text-muted">
                No SCIM audit entries recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-sm">
                  <thead>
                    <tr className="border-b-2 border-line text-left">
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Timestamp
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Action
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Entity
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Actor
                      </th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-muted">
                        Changes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-line/50 hover:bg-accent-soft"
                      >
                        <td className="whitespace-nowrap px-5 py-3 text-muted">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <ActionBadge action={entry.action} />
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-bold uppercase text-[10px] text-muted">
                            {entry.entityType}
                          </span>
                          <span className="ml-2 text-muted">
                            {entry.entityId.length > 16
                              ? entry.entityId.slice(0, 16) + "..."
                              : entry.entityId}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted">
                          {entry.actorId ?? "system"}
                        </td>
                        <td className="max-w-xs truncate px-5 py-3 text-muted">
                          {entry.changes
                            ? JSON.stringify(entry.changes)
                            : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/* ================================================================== */
/*  Presentational helpers                                             */
/* ================================================================== */

function ActionBadge({ action }: { action: string }) {
  let bg = "bg-zinc-200 text-zinc-700";
  if (action.includes("created")) bg = "bg-emerald-100 text-emerald-800";
  else if (action.includes("updated")) bg = "bg-blue-100 text-blue-800";
  else if (action.includes("deleted")) bg = "bg-red-100 text-red-800";

  return (
    <span
      className={`border-2 border-line px-2 py-0.5 text-[10px] font-bold uppercase ${bg}`}
    >
      {action}
    </span>
  );
}
