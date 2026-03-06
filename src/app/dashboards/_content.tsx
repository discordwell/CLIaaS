"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  widgetCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function DashboardsContent() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const loadDashboards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboards");
      if (res.ok) {
        const data = await res.json();
        setDashboards(data.dashboards ?? []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboards();
  }, [loadDashboards]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setName("");
        setDescription("");
        setShowCreate(false);
        if (data.dashboard?.id) {
          router.push(`/dashboards/${data.dashboard.id}`);
        } else {
          loadDashboards();
        }
      }
    } catch {
      /* ignore */
    }
    setCreating(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboards</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showCreate ? "Cancel" : "New Dashboard"}
        </button>
      </div>

      {showCreate && (
        <div className="mt-6 border-2 border-zinc-950 p-6">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            Create Dashboard
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
                placeholder="My Dashboard"
                autoFocus
              />
            </div>
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
                placeholder="Optional description..."
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Dashboard"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        ) : dashboards.length === 0 ? (
          <div className="border-2 border-dashed border-zinc-300 p-8 text-center">
            <p className="font-mono text-sm text-zinc-500">
              No dashboards yet.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Create Your First Dashboard
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dashboards.map((d) => (
              <button
                key={d.id}
                onClick={() => router.push(`/dashboards/${d.id}`)}
                className="block w-full border-2 border-zinc-200 p-4 text-left transition-colors hover:border-zinc-950"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-bold">{d.name}</h3>
                  <div className="flex gap-1">
                    {d.isDefault && (
                      <span className="bg-zinc-950 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
                        Default
                      </span>
                    )}
                  </div>
                </div>
                {d.description && (
                  <p className="mt-1 text-sm text-zinc-600">{d.description}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                    {d.widgetCount ?? 0} widget{(d.widgetCount ?? 0) !== 1 ? "s" : ""}
                  </span>
                  <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                    {new Date(d.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
