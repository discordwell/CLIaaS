"use client";

import { useEffect, useState, useCallback } from "react";

interface ScorecardCriterion {
  name: string;
  description: string;
  weight: number;
  maxScore: number;
}

interface QAScorecard {
  id: string;
  name: string;
  criteria: ScorecardCriterion[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface QAReview {
  id: string;
  ticketId?: string;
  conversationId?: string;
  scorecardId: string;
  reviewerId?: string;
  reviewType: "manual" | "auto";
  scores: Record<string, number>;
  totalScore: number;
  maxPossibleScore: number;
  notes?: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

interface DashboardMetrics {
  totalReviews: number;
  completedReviews: number;
  averageScore: number;
  averagePercentage: number;
  scorecardCount: number;
  recentReviews: QAReview[];
  byScorecard: Array<{
    scorecardId: string;
    scorecardName: string;
    reviewCount: number;
    avgScore: number;
    avgPercentage: number;
  }>;
}

export default function QAContent() {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [scorecards, setScorecards] = useState<QAScorecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewScorecard, setShowNewScorecard] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCriteria, setNewCriteria] = useState<ScorecardCriterion[]>([
    { name: "", description: "", weight: 1, maxScore: 5 },
  ]);

  const loadData = useCallback(async () => {
    try {
      const [dashRes, scRes] = await Promise.all([
        fetch("/api/qa/dashboard"),
        fetch("/api/qa/scorecards"),
      ]);
      const dashData = await dashRes.json();
      const scData = await scRes.json();
      setDashboard(dashData);
      setScorecards(scData.scorecards ?? []);
    } catch {
      setDashboard(null);
      setScorecards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreateScorecard(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const validCriteria = newCriteria.filter((c) => c.name.trim());
    if (validCriteria.length === 0) return;

    await fetch("/api/qa/scorecards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        criteria: validCriteria,
        enabled: true,
      }),
    });

    setNewName("");
    setNewCriteria([{ name: "", description: "", weight: 1, maxScore: 5 }]);
    setShowNewScorecard(false);
    loadData();
  }

  async function handleToggleScorecard(id: string, enabled: boolean) {
    await fetch(`/api/qa/scorecards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    loadData();
  }

  function addCriterion() {
    setNewCriteria([
      ...newCriteria,
      { name: "", description: "", weight: 1, maxScore: 5 },
    ]);
  }

  function updateCriterion(
    idx: number,
    field: keyof ScorecardCriterion,
    value: string | number
  ) {
    const updated = [...newCriteria];
    updated[idx] = { ...updated[idx], [field]: value };
    setNewCriteria(updated);
  }

  function removeCriterion(idx: number) {
    setNewCriteria(newCriteria.filter((_, i) => i !== idx));
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              QA & Conversation Review
            </p>
            <h1 className="mt-2 text-3xl font-bold">Quality Assurance</h1>
          </div>
          <button
            onClick={() => setShowNewScorecard(true)}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Scorecard
          </button>
        </div>
      </header>

      {/* Dashboard metrics */}
      {dashboard && (
        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Total Reviews
            </p>
            <p className="mt-2 text-3xl font-bold">
              {dashboard.totalReviews}
            </p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Completed
            </p>
            <p className="mt-2 text-3xl font-bold">
              {dashboard.completedReviews}
            </p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Avg Score
            </p>
            <p className="mt-2 text-3xl font-bold">
              {dashboard.averageScore}
            </p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Avg %
            </p>
            <p className="mt-2 text-3xl font-bold">
              {dashboard.averagePercentage}%
            </p>
          </div>
        </div>
      )}

      {/* New scorecard form */}
      {showNewScorecard && (
        <form
          onSubmit={handleCreateScorecard}
          className="mt-8 border-2 border-zinc-950 bg-white p-6"
        >
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            New Scorecard
          </p>

          <div className="mt-4">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Standard Support Review"
              className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <label className="font-mono text-xs font-bold uppercase text-zinc-500">
                Criteria
              </label>
              <button
                type="button"
                onClick={addCriterion}
                className="font-mono text-xs font-bold text-indigo-600 hover:text-indigo-800"
              >
                + Add Criterion
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {newCriteria.map((criterion, idx) => (
                <div
                  key={idx}
                  className="border border-zinc-200 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={criterion.name}
                      onChange={(e) =>
                        updateCriterion(idx, "name", e.target.value)
                      }
                      placeholder="Criterion name"
                      className="border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={criterion.description}
                      onChange={(e) =>
                        updateCriterion(idx, "description", e.target.value)
                      }
                      placeholder="Description"
                      className="border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="font-mono text-xs text-zinc-500">
                      Max Score:
                    </label>
                    <input
                      type="number"
                      value={criterion.maxScore}
                      onChange={(e) =>
                        updateCriterion(
                          idx,
                          "maxScore",
                          parseInt(e.target.value) || 5
                        )
                      }
                      min={1}
                      max={10}
                      className="w-16 border-2 border-zinc-300 px-2 py-1 text-sm focus:border-zinc-950 focus:outline-none"
                    />
                    {newCriteria.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCriterion(idx)}
                        className="ml-auto font-mono text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="submit"
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Create Scorecard
            </button>
            <button
              type="button"
              onClick={() => setShowNewScorecard(false)}
              className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Scorecards list */}
      {scorecards.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Scorecards
            </p>
          </div>
          <div className="divide-y divide-zinc-200">
            {scorecards.map((sc) => (
              <div key={sc.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          sc.enabled ? "bg-emerald-500" : "bg-zinc-300"
                        }`}
                      />
                      <p className="text-sm font-bold">{sc.name}</p>
                    </div>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      {sc.criteria.length} criteri
                      {sc.criteria.length !== 1 ? "a" : "on"} · Max{" "}
                      {sc.criteria.reduce((sum, c) => sum + c.maxScore, 0)}{" "}
                      points
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleScorecard(sc.id, sc.enabled)}
                    className={`px-3 py-1 font-mono text-xs font-bold uppercase ${
                      sc.enabled
                        ? "bg-emerald-500 text-white"
                        : "border-2 border-zinc-300 text-zinc-500"
                    }`}
                  >
                    {sc.enabled ? "Active" : "Inactive"}
                  </button>
                </div>

                {/* Criteria details */}
                <div className="mt-3 space-y-1">
                  {sc.criteria.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between font-mono text-xs"
                    >
                      <span className="text-zinc-700">{c.name}</span>
                      <span className="text-zinc-400">
                        max {c.maxScore} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* By scorecard breakdown */}
      {dashboard && dashboard.byScorecard.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Performance by Scorecard
            </p>
          </div>
          <div className="divide-y divide-zinc-200">
            {dashboard.byScorecard.map((entry) => (
              <div key={entry.scorecardId} className="p-5">
                <p className="text-sm font-bold">{entry.scorecardName}</p>
                <div className="mt-2 flex items-center gap-6 font-mono text-xs text-zinc-500">
                  <span>{entry.reviewCount} reviews</span>
                  <span>Avg: {entry.avgScore}</span>
                  <span>{entry.avgPercentage}%</span>
                </div>
                <div className="mt-2 h-2 w-full bg-zinc-100">
                  <div
                    className="h-2 bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(entry.avgPercentage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent reviews */}
      {dashboard && dashboard.recentReviews.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Recent Reviews
            </p>
          </div>
          <div className="divide-y divide-zinc-200">
            {dashboard.recentReviews.map((review) => (
              <div key={review.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        review.reviewType === "auto"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {review.reviewType}
                    </span>
                    <span className="text-sm font-bold">
                      {review.ticketId ?? review.conversationId ?? "N/A"}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-bold">
                    {review.totalScore}/{review.maxPossibleScore}
                  </span>
                </div>
                {review.notes && (
                  <p className="mt-2 text-xs text-zinc-500">{review.notes}</p>
                )}
                <p className="mt-1 font-mono text-xs text-zinc-400">
                  {new Date(review.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
