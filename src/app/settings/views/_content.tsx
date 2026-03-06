"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import ViewBuilder from "@/components/ViewBuilder";
import type { ViewQuery, ViewType } from "@/lib/views/types";

interface ViewItem {
  id: string;
  name: string;
  description?: string;
  query: ViewQuery;
  viewType: ViewType;
  userId?: string;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export default function ViewsSettingsContent() {
  const [views, setViews] = useState<ViewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newViewType, setNewViewType] = useState<"shared" | "personal">("shared");
  const [newQuery, setNewQuery] = useState<ViewQuery>({
    conditions: [{ field: "status", operator: "is", value: "open" }],
    combineMode: "and",
    sort: { field: "updated_at", direction: "desc" },
  });
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editQuery, setEditQuery] = useState<ViewQuery | null>(null);

  const flash = (msg: string, type: "success" | "error" = "success") => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(""), 4000);
  };

  const loadViews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/views");
      if (res.ok) {
        const data = await res.json();
        setViews(data.views ?? []);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          query: newQuery,
          viewType: newViewType,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewName("");
        setNewDescription("");
        setNewQuery({
          conditions: [{ field: "status", operator: "is", value: "open" }],
          combineMode: "and",
          sort: { field: "updated_at", direction: "desc" },
        });
        flash("View created");
        loadViews();
      } else {
        const data = await res.json();
        flash(data.error || "Failed to create view", "error");
      }
    } catch {
      flash("Failed to create view", "error");
    }
    setSaving(false);
  }

  function startEdit(view: ViewItem) {
    setEditingId(view.id);
    setEditName(view.name);
    setEditDescription(view.description ?? "");
    setEditQuery(view.query);
  }

  async function saveEdit() {
    if (!editingId || !editQuery) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/views/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          query: editQuery,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        flash("View updated");
        loadViews();
      } else {
        const data = await res.json();
        flash(data.error || "Failed to update view", "error");
      }
    } catch {
      flash("Failed to update view", "error");
    }
    setSaving(false);
  }

  async function toggleActive(view: ViewItem) {
    try {
      const res = await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !view.active }),
      });
      if (res.ok) {
        flash(view.active ? "View deactivated" : "View activated");
        loadViews();
      }
    } catch {
      // ignore
    }
  }

  async function handleDelete(view: ViewItem) {
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    try {
      const res = await fetch(`/api/views/${view.id}`, { method: "DELETE" });
      if (res.ok) {
        flash("View deleted");
        loadViews();
      } else {
        const data = await res.json();
        flash(data.error || "Failed to delete view", "error");
      }
    } catch {
      flash("Failed to delete view", "error");
    }
  }

  const sharedViews = views.filter((v) => v.viewType === "shared");
  const systemViews = views.filter((v) => v.viewType === "system");
  const personalViews = views.filter((v) => v.viewType === "personal");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/settings" className="hover:underline">
          Settings
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Views</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">View Management</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Create, edit, and manage shared and personal ticket views.
          System views cannot be modified.
        </p>
        {message && (
          <p
            className={`mt-2 font-mono text-xs ${
              messageType === "error" ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {message}
          </p>
        )}
      </header>

      {/* Create button */}
      <section className="mt-4 flex justify-end">
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showCreate ? "Cancel" : "New View"}
        </button>
      </section>

      {/* Create form */}
      {showCreate && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Create View
          </h3>
          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">
                  Name
                </span>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                  placeholder="e.g., High Priority Open"
                />
              </label>
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">
                  Type
                </span>
                <select
                  value={newViewType}
                  onChange={(e) =>
                    setNewViewType(e.target.value as "shared" | "personal")
                  }
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                >
                  <option value="shared">Shared (all agents)</option>
                  <option value="personal">Personal (only me)</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">
                Description
              </span>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Optional description..."
              />
            </label>

            <div>
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                Query Builder
              </span>
              <div className="mt-2 border border-zinc-200 p-4">
                <ViewBuilder
                  initialQuery={newQuery}
                  onQueryChange={setNewQuery}
                  showPreview={false}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !newName.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create View"}
            </button>
          </form>
        </section>
      )}

      {loading && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading views...</p>
        </section>
      )}

      {/* System Views */}
      {!loading && systemViews.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b border-zinc-200 px-6 py-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              System Views ({systemViews.length})
            </h3>
          </div>
          <div className="divide-y divide-zinc-200">
            {systemViews.map((view) => (
              <div
                key={view.id}
                className="flex items-center gap-4 px-6 py-3"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
                <div className="flex-1">
                  <span className="font-mono text-sm font-bold">
                    {view.name}
                  </span>
                  {view.description && (
                    <span className="ml-3 font-mono text-xs text-zinc-400">
                      {view.description}
                    </span>
                  )}
                </div>
                <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-500">
                  System
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Shared Views */}
      {!loading && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b border-zinc-200 px-6 py-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Shared Views ({sharedViews.length})
            </h3>
          </div>
          {sharedViews.length === 0 ? (
            <div className="p-6 text-center font-mono text-xs text-zinc-500">
              No shared views yet. Create one above.
            </div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {sharedViews.map((view) => (
                <div key={view.id} className="px-6 py-3">
                  {editingId === view.id ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="border border-zinc-300 px-2 py-1 font-mono text-sm"
                          placeholder="View name"
                        />
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="border border-zinc-300 px-2 py-1 font-mono text-sm"
                          placeholder="Description"
                        />
                      </div>
                      {editQuery && (
                        <div className="border border-zinc-200 p-3">
                          <ViewBuilder
                            initialQuery={editQuery}
                            onQueryChange={(q) => setEditQuery(q)}
                            showPreview={false}
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="font-mono text-xs font-bold text-emerald-600 hover:underline"
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="font-mono text-xs text-zinc-400 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          view.active ? "bg-emerald-500" : "bg-zinc-300"
                        }`}
                      />
                      <div className="flex-1">
                        <span className="font-mono text-sm font-bold">
                          {view.name}
                        </span>
                        {view.description && (
                          <span className="ml-3 font-mono text-xs text-zinc-400">
                            {view.description}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-xs text-zinc-400">
                        {view.query.conditions.length} condition
                        {view.query.conditions.length !== 1 ? "s" : ""}
                      </span>
                      <button
                        onClick={() => toggleActive(view)}
                        className={`font-mono text-xs font-bold hover:underline ${
                          view.active ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {view.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => startEdit(view)}
                        className="font-mono text-xs text-zinc-500 hover:text-zinc-950 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(view)}
                        className="font-mono text-xs text-red-500 hover:text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Personal Views */}
      {!loading && personalViews.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b border-zinc-200 px-6 py-3">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Personal Views ({personalViews.length})
            </h3>
          </div>
          <div className="divide-y divide-zinc-200">
            {personalViews.map((view) => (
              <div key={view.id} className="px-6 py-3">
                {editingId === view.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="border border-zinc-300 px-2 py-1 font-mono text-sm"
                        placeholder="View name"
                      />
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="border border-zinc-300 px-2 py-1 font-mono text-sm"
                        placeholder="Description"
                      />
                    </div>
                    {editQuery && (
                      <div className="border border-zinc-200 p-3">
                        <ViewBuilder
                          initialQuery={editQuery}
                          onQueryChange={(q) => setEditQuery(q)}
                          showPreview={false}
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={saving}
                        className="font-mono text-xs font-bold text-emerald-600 hover:underline"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="font-mono text-xs text-zinc-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        view.active ? "bg-blue-500" : "bg-zinc-300"
                      }`}
                    />
                    <div className="flex-1">
                      <span className="font-mono text-sm font-bold">
                        {view.name}
                      </span>
                      {view.description && (
                        <span className="ml-3 font-mono text-xs text-zinc-400">
                          {view.description}
                        </span>
                      )}
                    </div>
                    <span className="bg-blue-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-blue-600">
                      Personal
                    </span>
                    <button
                      onClick={() => startEdit(view)}
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-950 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(view)}
                      className="font-mono text-xs text-red-500 hover:text-red-700 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
