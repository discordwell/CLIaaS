"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Tag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  usageCount: number;
}

export default function TagSettingsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#71717a");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [message, setMessage] = useState("");

  const loadTags = () => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(loadTags, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (res.ok) {
        setNewName("");
        setNewColor("#71717a");
        setMessage("Tag created");
        loadTags();
      }
    } catch { /* silent */ }
    setCreating(false);
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await fetch(`/api/tags/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, color: editColor }),
      });
      setEditingId(null);
      setMessage("Tag updated");
      loadTags();
    } catch { /* silent */ }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete tag "${name}"? This will remove it from all tickets.`)) return;
    try {
      await fetch(`/api/tags/${id}`, { method: "DELETE" });
      setMessage("Tag deleted");
      loadTags();
    } catch { /* silent */ }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/settings" className="hover:underline">Settings</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Tags</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Tag Management</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Create, edit, and delete tags. Tags are shared across all tickets.
        </p>
        {message && (
          <p className="mt-2 font-mono text-xs text-emerald-600">{message}</p>
        )}
      </header>

      {/* Create form */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Create Tag
        </h3>
        <div className="mt-4 flex items-end gap-3">
          <div>
            <label className="block font-mono text-xs text-zinc-500">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. vip"
              className="mt-1 border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-zinc-500">Color</label>
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="mt-1 h-[38px] w-[50px] cursor-pointer border-2 border-zinc-950"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </section>

      {/* Tag list */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            All Tags ({tags.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-6 text-center font-mono text-xs text-zinc-500">Loading...</div>
        ) : tags.length === 0 ? (
          <div className="p-6 text-center font-mono text-xs text-zinc-500">No tags yet</div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-4 px-6 py-3">
                {editingId === tag.id ? (
                  <>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-6 w-6 cursor-pointer border border-zinc-300"
                    />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 border border-zinc-300 px-2 py-1 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={saveEdit}
                      className="font-mono text-xs font-bold text-emerald-600 hover:underline"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="font-mono text-xs text-zinc-400 hover:underline"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      className="inline-block h-4 w-4 border border-zinc-300"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 font-mono text-sm font-bold">{tag.name}</span>
                    <span className="font-mono text-xs text-zinc-400">
                      {tag.usageCount} ticket{tag.usageCount !== 1 ? "s" : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(tag)}
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-950 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tag.id, tag.name)}
                      className="font-mono text-xs text-red-500 hover:text-red-700 hover:underline"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
