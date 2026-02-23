"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Types ----

interface SandboxData {
  id: string;
  name: string;
  createdAt: string;
  status: "active" | "archived";
  promotedAt?: string;
  expiresAt?: string;
  cloneManifest?: { clonedFiles: string[]; clonedAt: string };
}

interface DiffEntry {
  file: string;
  id: string;
  action: "added" | "modified" | "deleted";
  changes?: Record<string, { from: unknown; to: unknown }>;
}

interface DiffData {
  sandboxId: string;
  entries: DiffEntry[];
  summary: { added: number; modified: number; deleted: number; total: number };
}

// ---- Main Component ----

export default function SandboxPage() {
  const [sandboxes, setSandboxes] = useState<SandboxData[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffData | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [promoteResult, setPromoteResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox");
      const data = await res.json();
      setSandboxes(data.sandboxes ?? []);
    } catch {
      setSandboxes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName }),
      });
      setCreateName("");
      setShowCreate(false);
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sandbox/${id}`, { method: "DELETE" });
    setSelectedId(null);
    setDiff(null);
    load();
  }

  async function handleDiff(id: string) {
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await fetch(`/api/sandbox/${id}/diff`);
      const data = await res.json();
      setDiff(data.diff ?? null);
    } catch {
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }

  async function handlePromote(id: string) {
    setPromoteResult(null);
    try {
      const res = await fetch(`/api/sandbox/${id}/promote`, { method: "POST" });
      const data = await res.json();
      setPromoteResult(
        `Promoted! ${data.applied ?? 0} change(s) applied.${
          data.errors?.length ? ` Errors: ${data.errors.join(", ")}` : ""
        }`,
      );
      setDiff(null);
      load();
    } catch {
      setPromoteResult("Promotion failed.");
    }
  }

  function statusColor(status: string): string {
    return status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : "bg-zinc-200 text-zinc-600";
  }

  function actionColor(action: string): string {
    switch (action) {
      case "added":
        return "bg-emerald-100 text-emerald-700";
      case "modified":
        return "bg-amber-100 text-amber-700";
      case "deleted":
        return "bg-red-100 text-red-700";
      default:
        return "bg-zinc-200 text-zinc-600";
    }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading sandboxes...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Environments
            </p>
            <h1 className="mt-2 text-3xl font-bold">Sandbox Environments</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Clone production data, test changes, and promote back safely.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showCreate ? "Cancel" : "New Sandbox"}
          </button>
        </div>
      </header>

      {/* Create Form */}
      {showCreate && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Create Sandbox
          </h3>
          <form onSubmit={handleCreate} className="mt-4 flex gap-4">
            <input
              type="text"
              required
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Environment name (e.g., QA Sprint 47)"
              className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
            <button
              type="submit"
              disabled={creating}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </form>
        </section>
      )}

      {/* Promote Result */}
      {promoteResult && (
        <div className="mt-4 border-2 border-emerald-600 bg-emerald-50 p-4">
          <p className="font-mono text-xs text-emerald-700">{promoteResult}</p>
        </div>
      )}

      {/* Diff Viewer */}
      {diff && (
        <section className="mt-4 border-2 border-zinc-950 bg-white">
          <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
            <div>
              <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Diff: {diff.sandboxId}
              </h3>
              <div className="mt-2 flex gap-3 font-mono text-xs">
                <span className="text-emerald-600">
                  +{diff.summary.added} added
                </span>
                <span className="text-amber-600">
                  ~{diff.summary.modified} modified
                </span>
                <span className="text-red-600">
                  -{diff.summary.deleted} deleted
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              {diff.entries.length > 0 && (
                <button
                  onClick={() => handlePromote(diff.sandboxId)}
                  className="border-2 border-emerald-600 bg-emerald-600 px-4 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-700"
                >
                  Promote All
                </button>
              )}
              <button
                onClick={() => setDiff(null)}
                className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
              >
                Close
              </button>
            </div>
          </div>

          {diff.entries.length === 0 ? (
            <div className="p-6 text-center">
              <p className="font-mono text-sm text-zinc-500">No changes detected.</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                    <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">Action</th>
                    <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">File</th>
                    <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">ID</th>
                    <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.entries.map((entry, i) => (
                    <tr key={i} className="border-b border-zinc-100">
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${actionColor(entry.action)}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{entry.file}</td>
                      <td className="max-w-[120px] truncate px-4 py-2 font-mono text-xs text-zinc-500">
                        {entry.id}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                        {entry.changes
                          ? Object.keys(entry.changes).join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Sandbox List */}
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {sandboxes.length} Sandbox{sandboxes.length !== 1 ? "es" : ""}
        </h2>
      </div>

      {sandboxes.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Created</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Expires</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Files</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {sandboxes.map((sb) => (
                  <tr
                    key={sb.id}
                    className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${
                      selectedId === sb.id ? "bg-zinc-100" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor(sb.status)}`}>
                        {sb.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{sb.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {new Date(sb.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {sb.expiresAt
                        ? new Date(sb.expiresAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {sb.cloneManifest?.clonedFiles?.length ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {sb.status === "active" && (
                          <>
                            <button
                              onClick={() => {
                                setSelectedId(sb.id);
                                handleDiff(sb.id);
                              }}
                              className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                            >
                              Diff
                            </button>
                            <button
                              onClick={() => handleDelete(sb.id)}
                              className="font-mono text-xs font-bold uppercase text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        {sb.promotedAt && (
                          <span className="font-mono text-xs text-zinc-400">
                            Promoted {new Date(sb.promotedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No sandboxes</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create a sandbox to clone production data and test changes safely.
          </p>
        </section>
      )}

      {diffLoading && (
        <div className="mt-4 border-2 border-zinc-950 bg-white p-6 text-center">
          <p className="font-mono text-sm text-zinc-500">Computing diff...</p>
        </div>
      )}
    </main>
  );
}
