"use client";

import { useState, useEffect, useCallback } from "react";
import PermissionGate from "./PermissionGate";
import RoleBadge from "./RoleBadge";

interface Collaborator {
  id: string;
  userId: string;
  canReply: boolean;
  userName: string;
  userEmail: string | null;
  userRole: string;
  createdAt: string;
}

interface CollaboratorPanelProps {
  ticketId: string;
}

export default function CollaboratorPanel({ ticketId }: CollaboratorPanelProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add form state
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [canReply, setCanReply] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/collaborators`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setCollaborators(data.collaborators ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load collaborators");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchCollaborators();
  }, [fetchCollaborators]);

  // Debounced user search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (res.ok && data.users) {
          // Exclude users already collaborating
          const existingIds = new Set(collaborators.map((c) => c.userId));
          setSearchResults(
            data.users.filter(
              (u: { id: string }) => !existingIds.has(u.id),
            ),
          );
        }
      } catch {
        // Ignore search errors
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, collaborators]);

  async function addCollaborator(userId: string) {
    setAdding(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, canReply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setSearchQuery("");
      setSearchResults([]);
      setCanReply(false);
      setShowAdd(false);
      fetchCollaborators();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add collaborator");
    } finally {
      setAdding(false);
    }
  }

  async function removeCollaborator(userId: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/collaborators`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove");
      fetchCollaborators();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove collaborator");
    }
  }

  return (
    <section className="border-2 border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
          Collaborators
        </h3>
        <PermissionGate permission="tickets:update_assignee">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-xs font-bold text-zinc-500 hover:text-zinc-950"
          >
            {showAdd ? "Cancel" : "+ Add"}
          </button>
        </PermissionGate>
      </div>

      {/* Add form */}
      {showAdd && (
        <PermissionGate permission="tickets:update_assignee">
          <div className="mt-3 border-2 border-zinc-100 bg-zinc-50 p-3">
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
            />
            {searching && (
              <p className="mt-1 text-xs text-zinc-400">Searching...</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto">
                {searchResults.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between border-b border-zinc-100 py-1.5 last:border-b-0"
                  >
                    <span className="text-sm">
                      {user.name}{" "}
                      <span className="font-mono text-xs text-zinc-400">
                        {user.email}
                      </span>
                    </span>
                    <button
                      onClick={() => addCollaborator(user.id)}
                      disabled={adding}
                      className="border border-zinc-950 px-2 py-0.5 text-xs font-bold hover:bg-zinc-950 hover:text-white disabled:opacity-50"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={canReply}
                onChange={(e) => setCanReply(e.target.checked)}
                className="accent-zinc-950"
              />
              Can reply publicly
            </label>
          </div>
        </PermissionGate>
      )}

      {/* Collaborator list */}
      {loading ? (
        <p className="mt-3 text-xs text-zinc-400">Loading...</p>
      ) : error ? (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      ) : collaborators.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-400">No collaborators</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {collaborators.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.userName}</span>
                {c.userEmail && (
                  <span className="font-mono text-xs text-zinc-400">
                    {c.userEmail}
                  </span>
                )}
                <RoleBadge role={c.userRole} />
                {c.canReply && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                    can reply
                  </span>
                )}
              </div>
              <PermissionGate permission="tickets:update_assignee">
                <button
                  onClick={() => removeCollaborator(c.userId)}
                  className="text-xs font-bold text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </PermissionGate>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
