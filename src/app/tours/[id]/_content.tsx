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
}

interface TourStep {
  id: string;
  tourId: string;
  position: number;
  targetSelector: string;
  title: string;
  body: string;
  placement: string;
  highlightTarget: boolean;
  actionLabel: string;
}

export default function TourDetailContent({ tourId }: { tourId: string }) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({
    targetSelector: "",
    title: "",
    body: "",
    placement: "bottom" as string,
    actionLabel: "Next",
  });

  const loadTour = useCallback(async () => {
    try {
      const [tourRes, stepsRes] = await Promise.all([
        fetch(`/api/tours/${tourId}`),
        fetch(`/api/tours/${tourId}/steps`),
      ]);
      if (tourRes.ok) {
        const data = await tourRes.json();
        setTour(data.tour);
      }
      if (stepsRes.ok) {
        const data = await stepsRes.json();
        setSteps(data.steps ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [tourId]);

  useEffect(() => { loadTour(); }, [loadTour]);

  async function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch(`/api/tours/${tourId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        setAddForm({ targetSelector: "", title: "", body: "", placement: "bottom", actionLabel: "Next" });
        loadTour();
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteStep(stepId: string) {
    try {
      await fetch(`/api/tours/${tourId}/steps/${stepId}`, { method: "DELETE" });
      loadTour();
    } catch { /* ignore */ }
  }

  async function handleToggle() {
    try {
      await fetch(`/api/tours/${tourId}`, { method: "PATCH" });
      loadTour();
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading tour...</p>
        </section>
      </main>
    );
  }

  if (!tour) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">Tour not found</p>
          <Link href="/tours" className="mt-2 inline-block font-mono text-xs font-bold text-blue-600">Back to Tours</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/tours" className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950">Tours /</Link>
            <h1 className="mt-2 text-3xl font-bold">{tour.name}</h1>
            {tour.description && <p className="mt-1 text-sm text-zinc-600">{tour.description}</p>}
            <div className="mt-2 flex items-center gap-3">
              <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${tour.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
                {tour.isActive ? "Active" : "Inactive"}
              </span>
              <span className="font-mono text-xs text-zinc-500">{tour.targetUrlPattern}</span>
              <span className="font-mono text-xs text-zinc-400">{steps.length} steps</span>
            </div>
          </div>
          <button
            onClick={handleToggle}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase text-white ${
              tour.isActive ? "border-amber-600 bg-amber-600 hover:bg-amber-700" : "border-emerald-600 bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {tour.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      </header>

      {/* Steps */}
      <section className="mt-4 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-200 p-6">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Tour Steps</h2>
        </div>
        <div className="p-6">
          {steps.length === 0 ? (
            <p className="font-mono text-sm text-zinc-500">No steps yet. Add your first step below.</p>
          ) : (
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={s.id} className="flex items-start gap-3 border-2 border-zinc-200 p-4">
                  <span className="flex h-6 w-6 items-center justify-center border border-zinc-300 font-mono text-xs font-bold text-zinc-500">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium">{s.title}</p>
                    <p className="mt-1 text-sm text-zinc-600">{s.body}</p>
                    <div className="mt-2 flex gap-3 font-mono text-xs text-zinc-400">
                      <span>Selector: {s.targetSelector}</span>
                      <span>Placement: {s.placement}</span>
                      <span>CTA: {s.actionLabel}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteStep(s.id)}
                    className="font-mono text-xs font-bold text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Add Step */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Add Step</h3>
        <form onSubmit={handleAddStep} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Target Selector</span>
            <input
              type="text"
              required
              value={addForm.targetSelector}
              onChange={(e) => setAddForm({ ...addForm, targetSelector: e.target.value })}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              placeholder='[data-tour="tickets"]'
            />
          </label>
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Title</span>
            <input
              type="text"
              required
              value={addForm.title}
              onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-mono text-xs font-bold uppercase">Body</span>
            <textarea
              value={addForm.body}
              onChange={(e) => setAddForm({ ...addForm, body: e.target.value })}
              rows={2}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Placement</span>
            <select
              value={addForm.placement}
              onChange={(e) => setAddForm({ ...addForm, placement: e.target.value })}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="center">Center</option>
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Action Label</span>
            <input
              type="text"
              value={addForm.actionLabel}
              onChange={(e) => setAddForm({ ...addForm, actionLabel: e.target.value })}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Add Step
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
