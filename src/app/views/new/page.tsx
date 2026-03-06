"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ViewBuilder from "@/components/ViewBuilder";
import type { ViewQuery } from "@/lib/views/types";

export default function NewViewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [viewType, setViewType] = useState<"shared" | "personal">("shared");
  const [query, setQuery] = useState<ViewQuery>({
    conditions: [{ field: "status", operator: "is", value: "open" }],
    combineMode: "and",
    sort: { field: "updated_at", direction: "desc" },
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleQueryChange = useCallback((q: ViewQuery) => {
    setQuery(q);
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("View name is required");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, query, viewType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create view");

      const viewId = data.view?.id;
      router.push(`/tickets?view=${viewId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/tickets" className="hover:underline">Tickets</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">New View</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Create View</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Build a saved filter to quickly access specific tickets.
        </p>
      </header>

      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Open Tickets"
                className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Type</label>
              <select
                value={viewType}
                onChange={(e) => setViewType(e.target.value as "shared" | "personal")}
                className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
              >
                <option value="shared">Shared (visible to all)</option>
                <option value="personal">Personal (only me)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label className="mb-3 block font-mono text-xs font-bold uppercase text-zinc-500">Conditions</label>
            <ViewBuilder initialQuery={query} onQueryChange={handleQueryChange} />
          </div>
        </div>
      </section>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create View"}
        </button>
        <Link
          href="/tickets"
          className="border-2 border-zinc-300 bg-white px-6 py-3 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950"
        >
          Cancel
        </Link>
        {error && (
          <span className="font-mono text-xs text-red-600">{error}</span>
        )}
      </div>
    </main>
  );
}
