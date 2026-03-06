"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Signature {
  id: string;
  name: string;
  bodyHtml: string;
  bodyText: string;
  isDefault: boolean;
}

export default function SignaturesPage() {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSigs = () => {
    fetch("/api/signatures?user=me")
      .then((r) => r.json())
      .then((d) => setSignatures(d.signatures ?? []))
      .catch(() => setSignatures([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSigs(); }, []);

  const resetForm = () => {
    setName(""); setBodyText(""); setBodyHtml(""); setIsDefault(false);
    setEditId(null); setShowForm(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !bodyText.trim()) return;
    setSaving(true);
    try {
      const url = editId ? `/api/signatures/${editId}` : "/api/signatures";
      const method = editId ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bodyText, bodyHtml: bodyHtml || bodyText, isDefault }),
      });
      resetForm();
      fetchSigs();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (s: Signature) => {
    setEditId(s.id);
    setName(s.name);
    setBodyText(s.bodyText);
    setBodyHtml(s.bodyHtml);
    setIsDefault(s.isDefault);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/signatures/${id}`, { method: "DELETE" });
    fetchSigs();
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span>/</span>
        <Link href="/settings" className="hover:underline">Settings</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Signatures</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Agent Settings</p>
            <h1 className="mt-2 text-3xl font-bold">Email Signatures</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Create and manage signatures that can be appended to outgoing replies.
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            + New Signature
          </button>
        </div>
      </header>

      {showForm && (
        <section className="mt-6 border-2 border-zinc-950 bg-white p-6">
          <h3 className="text-lg font-bold">{editId ? "Edit" : "New"} Signature</h3>
          <div className="mt-4">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Default, Marketing"
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none" />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Plain Text</label>
              <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={4}
                placeholder="Best regards,&#10;Your Name"
                className="mt-1 w-full border-2 border-zinc-300 p-3 text-sm font-mono focus:border-zinc-950 focus:outline-none" />
            </div>
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">HTML (optional)</label>
              <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={4}
                placeholder="<p>Best regards,<br><strong>Your Name</strong></p>"
                className="mt-1 w-full border-2 border-zinc-300 p-3 text-sm font-mono focus:border-zinc-950 focus:outline-none" />
            </div>
          </div>
          {bodyHtml && (
            <div className="mt-4">
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Preview</label>
              <div className="mt-1 border-2 border-zinc-200 bg-zinc-50 p-4" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            </div>
          )}
          <div className="mt-4">
            <label className="flex items-center gap-2 font-mono text-xs font-bold text-zinc-600">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4" />
              Set as default signature
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={handleSave} disabled={saving || !name.trim() || !bodyText.trim()}
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

      <section className="mt-6 border-2 border-zinc-950 bg-white">
        {loading ? (
          <p className="p-8 text-center text-sm text-zinc-500">Loading...</p>
        ) : signatures.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No signatures yet.</p>
        ) : (
          <div className="divide-y divide-zinc-200">
            {signatures.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-4 hover:bg-zinc-50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">{s.name}</span>
                    {s.isDefault && (
                      <span className="bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700">DEFAULT</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 line-clamp-1">{s.bodyText}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleEdit(s)} className="font-mono text-xs text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => handleDelete(s.id)} className="font-mono text-xs text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
