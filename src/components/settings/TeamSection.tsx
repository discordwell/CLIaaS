"use client";

import { useState, useEffect, useCallback } from "react";

interface TeamUser {
  id: string;
  email: string | null;
  name: string;
  role: string;
  status: string;
  createdAt: string;
}

const ROLE_OPTIONS = ["admin", "agent", "viewer"] as const;

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  invited: "bg-amber-100 text-amber-800",
  disabled: "bg-zinc-200 text-zinc-500",
  inactive: "bg-zinc-200 text-zinc-500",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  admin: "bg-blue-100 text-blue-800",
  agent: "bg-zinc-100 text-zinc-700",
  viewer: "bg-zinc-100 text-zinc-500",
};

export default function TeamSection({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState<string>("agent");
  const [inviting, setInviting] = useState(false);
  const [invMsg, setInvMsg] = useState("");

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMembers(data.users);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function invite() {
    if (!invEmail || !invName) return;
    setInviting(true);
    setInvMsg("");
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invEmail, name: invName, role: invRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invite failed");
      setInvMsg("Invited!");
      setInvEmail("");
      setInvName("");
      setInvRole("agent");
      setShowInvite(false);
      fetchMembers();
    } catch (err: unknown) {
      setInvMsg(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchMembers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to change role");
    }
  }

  async function toggleDisable(userId: string, currentStatus: string) {
    if (currentStatus === "disabled") {
      // Re-enable
      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "active" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        fetchMembers();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    } else {
      // Disable
      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        fetchMembers();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : "Failed");
      }
    }
  }

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Team</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
        >
          {showInvite ? "Cancel" : "Invite Member"}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="mt-4 border-2 border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap gap-3">
            <input
              type="email"
              placeholder="Email"
              value={invEmail}
              onChange={(e) => setInvEmail(e.target.value)}
              className="flex-1 border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Name"
              value={invName}
              onChange={(e) => setInvName(e.target.value)}
              className="flex-1 border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <select
              value={invRole}
              onChange={(e) => setInvRole(e.target.value)}
              className="border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              onClick={invite}
              disabled={inviting || !invEmail || !invName}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {inviting ? "Inviting…" : "Send Invite"}
            </button>
          </div>
          {invMsg && (
            <p className={`mt-2 text-xs font-medium ${invMsg === "Invited!" ? "text-emerald-600" : "text-red-600"}`}>
              {invMsg}
            </p>
          )}
        </div>
      )}

      {/* Members table */}
      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading team…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-200 text-xs font-bold uppercase tracking-wider text-zinc-500">
                <th className="pb-3 pr-4">Name</th>
                <th className="pb-3 pr-4">Email</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100">
                  <td className="py-3 pr-4 font-medium">
                    {m.name}
                    {m.id === currentUserId && (
                      <span className="ml-2 text-xs text-zinc-400">(you)</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-zinc-500">
                    {m.email ?? "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${ROLE_COLORS[m.role] ?? ROLE_COLORS.agent}`}
                    >
                      {m.role}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[m.status] ?? STATUS_COLORS.active}`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="py-3">
                    {m.id !== currentUserId && m.role !== "owner" && (
                      <div className="flex gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.id, e.target.value)}
                          className="border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-950 focus:outline-none"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => toggleDisable(m.id, m.status)}
                          className={`border px-2 py-1 text-xs font-bold ${
                            m.status === "disabled"
                              ? "border-emerald-600 text-emerald-600 hover:bg-emerald-50"
                              : "border-red-600 text-red-600 hover:bg-red-50"
                          }`}
                        >
                          {m.status === "disabled" ? "Enable" : "Disable"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
