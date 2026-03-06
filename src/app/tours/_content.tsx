"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Tour {
  id: string;
  name: string;
  description?: string;
  targetUrlPattern: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export default function ToursPageContent() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "", targetUrlPattern: "*" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tours");
      const data = await res.json();
      setTours(data.tours ?? []);
    } catch { setTours([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setCreateForm({ name: "", description: "", targetUrlPattern: "*" });
        setShowCreate(false);
        load();
      }
    } catch { /* ignore */ }
    finally { setCreating(false); }
  }

  async function handleToggle(id: string) {
    try {
      await fetch(`/api/tours/${id}`, { method: "PATCH" });
      load();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/tours/${id}`, { method: "DELETE" });
      load();
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading tours...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Proactive Messaging
            </p>
            <h1 className="mt-2 text-3xl font-bold">Product Tours</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Guide customers through your product with step-by-step tours.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showCreate ? "Cancel" : "New Tour"}
          </button>
        </div>
      </header>

      {showCreate && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Tour</h3>
          <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Name</span>
              <input
                type="text"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="e.g. Getting Started"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">URL Pattern</span>
              <input
                type="text"
                value={createForm.targetUrlPattern}
                onChange={(e) => setCreateForm({ ...createForm, targetUrlPattern: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="/dashboard*"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="font-mono text-xs font-bold uppercase">Description</span>
              <input
                type="text"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Tour"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">{tours.length} Tour{tours.length !== 1 ? "s" : ""}</h2>
      </div>

      {tours.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">URL Pattern</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Priority</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {tours.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${t.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{t.targetUrlPattern}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.priority}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link href={`/tours/${t.id}`} className="font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950">
                          Edit
                        </Link>
                        <button
                          onClick={() => handleToggle(t.id)}
                          className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                        >
                          {t.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
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
          <p className="text-lg font-bold">No tours yet</p>
          <p className="mt-2 text-sm text-zinc-600">Create your first product tour to onboard customers.</p>
        </section>
      )}
    </main>
  );
}
