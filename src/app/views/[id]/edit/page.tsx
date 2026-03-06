"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import ViewBuilder from "@/components/ViewBuilder";
import type { ViewQuery } from "@/lib/views/types";

export default function EditViewPage() {
  const router = useRouter();
  const params = useParams();
  const viewId = params.id as string;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState<ViewQuery | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/views/${viewId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.view) {
          setName(d.view.name);
          setDescription(d.view.description ?? "");
          setQuery(d.view.query);
        } else {
          setError("View not found");
        }
      })
      .catch(() => setError("Failed to load view"))
      .finally(() => setLoading(false));
  }, [viewId]);

  const handleQueryChange = useCallback((q: ViewQuery) => {
    setQuery(q);
  }, []);

  const handleSave = async () => {
    if (!name.trim()) { setError("Name required"); return; }
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/views/${viewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.push(`/tickets?view=${viewId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
        <p className="font-mono text-sm text-zinc-500">Loading view...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/tickets" className="hover:underline">Tickets</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Edit View</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Edit View</h1>
      </header>

      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <div className="space-y-6">
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm"
            />
          </div>
          {query && (
            <div>
              <label className="mb-3 block font-mono text-xs font-bold uppercase text-zinc-500">Conditions</label>
              <ViewBuilder initialQuery={query} onQueryChange={handleQueryChange} />
            </div>
          )}
        </div>
      </section>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <Link
          href="/tickets"
          className="border-2 border-zinc-300 bg-white px-6 py-3 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950"
        >
          Cancel
        </Link>
        {error && <span className="font-mono text-xs text-red-600">{error}</span>}
      </div>
    </main>
  );
}
