"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CannedResponse {
  id: string;
  title: string;
  body: string;
  category?: string;
  scope: string;
  shortcut?: string;
  usageCount: number;
  updatedAt: string;
}

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState<"personal" | "shared">("shared");
  const [shortcut, setShortcut] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchResponses = () => {
    fetch("/api/canned-responses")
      .then((r) => r.json())
      .then((d) => setResponses(d.cannedResponses ?? []))
      .catch(() => setResponses([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchResponses(); }, []);

  const resetForm = () => {
    setTitle(""); setBody(""); setCategory(""); setScope("shared"); setShortcut("");
    setEditId(null); setShowForm(false);
  };

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const url = editId ? `/api/canned-responses/${editId}` : "/api/canned-responses";
      const method = editId ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, category: category || undefined, scope, shortcut: shortcut || undefined }),
      });
      resetForm();
      fetchResponses();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (cr: CannedResponse) => {
    setEditId(cr.id);
    setTitle(cr.title);
    setBody(cr.body);
    setCategory(cr.category ?? "");
    setScope(cr.scope as "personal" | "shared");
    setShortcut(cr.shortcut ?? "");
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/canned-responses/${id}`, { method: "DELETE" });
    fetchResponses();
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span>/</span>
        <Link href="/settings" className="hover:underline">Settings</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Canned Responses</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Templates</p>
            <h1 className="mt-2 text-3xl font-bold">Canned Responses</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Reusable reply templates with merge variable support. Use {"{{customer.name}}"}, {"{{ticket.id}}"}, etc.
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            + New Template
          </button>
        </div>
      </header>

      {/* CREATE/EDIT FORM */}
      {showForm && (
        <section className="mt-6 border-2 border-zinc-950 bg-white p-6">
          <h3 className="text-lg font-bold">{editId ? "Edit" : "New"} Canned Response</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Category</label>
                <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Billing"
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none" />
              </div>
              <div>
                <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Scope</label>
                <select value={scope} onChange={(e) => setScope(e.target.value as "personal" | "shared")}
                  className="mt-1 border-2 border-zinc-300 px-3 py-2 text-sm font-mono focus:border-zinc-950 focus:outline-none">
                  <option value="shared">Shared</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Shortcut</label>
                <input type="text" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/thanks"
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm font-mono focus:border-zinc-950 focus:outline-none" />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
              placeholder="Hi {{customer.name}},&#10;&#10;..."
              className="mt-1 w-full border-2 border-zinc-300 p-3 text-sm font-mono focus:border-zinc-950 focus:outline-none" />
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={handleSave} disabled={saving || !title.trim() || !body.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
              {saving ? "Saving..." : editId ? "Update" : "Create"}
            </button>
            <button onClick={resetForm}
              className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950">
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* TABLE */}
      <section className="mt-6 border-2 border-zinc-950 bg-white">
        {loading ? (
          <p className="p-8 text-center text-sm text-zinc-500">Loading...</p>
        ) : responses.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No canned responses yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-zinc-950 bg-zinc-50">
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Title</th>
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Category</th>
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Scope</th>
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Shortcut</th>
                <th className="p-3 text-right font-mono text-xs font-bold uppercase text-zinc-500">Uses</th>
                <th className="p-3 text-right font-mono text-xs font-bold uppercase text-zinc-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((cr) => (
                <tr key={cr.id} className="border-b border-zinc-200 hover:bg-zinc-50">
                  <td className="p-3">
                    <span className="text-sm font-bold">{cr.title}</span>
                    <p className="mt-0.5 text-xs text-zinc-500 line-clamp-1">{cr.body.slice(0, 60)}...</p>
                  </td>
                  <td className="p-3 font-mono text-xs text-zinc-600">{cr.category ?? "—"}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 font-mono text-[10px] font-bold ${cr.scope === "shared" ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
                      {cr.scope.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs text-zinc-500">{cr.shortcut ?? "—"}</td>
                  <td className="p-3 text-right font-mono text-xs text-zinc-600">{cr.usageCount}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleEdit(cr)} className="font-mono text-xs text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => handleDelete(cr.id)} className="ml-3 font-mono text-xs text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
