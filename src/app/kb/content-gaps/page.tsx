"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ContentGap {
  id: string;
  topic: string;
  ticketCount: number;
  sampleTicketIds?: string[];
  suggestedTitle?: string;
  suggestedOutline?: string;
  status: string;
  createdArticleId?: string;
  createdAt: string;
  updatedAt: string;
}

const statusColors: Record<string, string> = {
  open: "bg-amber-400 text-black",
  accepted: "bg-emerald-500 text-white",
  dismissed: "bg-zinc-400 text-white",
  stale: "bg-zinc-300 text-zinc-600",
};

export default function ContentGapsPage() {
  const [gaps, setGaps] = useState<ContentGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchGaps = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        filter === "all"
          ? "/api/kb/content-gaps"
          : `/api/kb/content-gaps?status=${filter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setGaps(data.gaps ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchGaps();
  }, [fetchGaps]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/kb/content-gaps", { method: "POST" });
      if (res.ok) {
        await fetchGaps();
      }
    } catch {
      // Silently fail
    } finally {
      setAnalyzing(false);
    }
  };

  const updateGap = async (gapId: string, status: string) => {
    try {
      const res = await fetch(`/api/kb/content-gaps/${gapId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setGaps((prev) =>
          prev.map((g) => (g.id === gapId ? { ...g, status } : g)),
        );
      }
    } catch {
      // Silently fail
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/kb" className="hover:underline">
            Knowledge Base
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Content Gaps</span>
        </nav>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Content Gaps</h1>
            <p className="mt-2 text-sm font-medium text-zinc-600">
              Topics with recurring support tickets but no matching KB article.
              Analyze gaps and create articles to reduce ticket volume.
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="shrink-0 border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {analyzing ? "Analyzing..." : "Run Analysis"}
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="mt-6 flex gap-2">
        {["all", "open", "accepted", "dismissed", "stale"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
              filter === s
                ? "bg-zinc-950 text-white"
                : "bg-white text-zinc-950 hover:bg-zinc-100"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Gap list */}
      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading gaps...</p>
        </div>
      ) : gaps.length === 0 ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No content gaps found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Run an analysis to detect gaps in your knowledge base.
          </p>
        </div>
      ) : (
        <div className="mt-8 border-2 border-zinc-950 bg-white">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_100px_140px] gap-4 border-b-2 border-zinc-950 bg-zinc-50 px-6 py-3">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Topic
            </span>
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Tickets
            </span>
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Status
            </span>
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Actions
            </span>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-zinc-200">
            {gaps.map((gap) => (
              <div key={gap.id}>
                <div className="grid grid-cols-[1fr_100px_100px_140px] items-center gap-4 px-6 py-4">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expandedId === gap.id ? null : gap.id)
                    }
                    className="text-left"
                  >
                    <span className="text-sm font-bold hover:underline">
                      {gap.suggestedTitle ?? gap.topic}
                    </span>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      {gap.topic}
                    </p>
                  </button>
                  <span className="font-mono text-sm font-bold">
                    {gap.ticketCount}
                  </span>
                  <span
                    className={`inline-block w-fit px-2 py-1 font-mono text-[10px] font-bold uppercase ${
                      statusColors[gap.status] ?? "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {gap.status}
                  </span>
                  <div className="flex gap-2">
                    {gap.status === "open" && (
                      <>
                        <button
                          onClick={() => updateGap(gap.id, "accepted")}
                          className="border border-zinc-950 px-2 py-1 font-mono text-[10px] font-bold uppercase transition-colors hover:bg-emerald-50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => updateGap(gap.id, "dismissed")}
                          className="border border-zinc-300 px-2 py-1 font-mono text-[10px] font-bold uppercase text-zinc-500 transition-colors hover:bg-zinc-100"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    {gap.status === "dismissed" && (
                      <button
                        onClick={() => updateGap(gap.id, "open")}
                        className="border border-zinc-950 px-2 py-1 font-mono text-[10px] font-bold uppercase transition-colors hover:bg-zinc-100"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {expandedId === gap.id && (
                  <div className="border-t border-zinc-200 bg-zinc-50 px-6 py-4">
                    {gap.suggestedOutline && (
                      <div className="mb-3">
                        <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                          Suggested Outline
                        </span>
                        <p className="mt-1 text-sm text-zinc-700">
                          {gap.suggestedOutline}
                        </p>
                      </div>
                    )}
                    {gap.sampleTicketIds && gap.sampleTicketIds.length > 0 && (
                      <div>
                        <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                          Sample Questions
                        </span>
                        <ul className="mt-1 space-y-1">
                          {gap.sampleTicketIds.map((q, i) => (
                            <li
                              key={i}
                              className="text-sm text-zinc-600"
                            >
                              &bull; {q}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {gap.createdArticleId && (
                      <div className="mt-3">
                        <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                          Linked Article
                        </span>
                        <p className="mt-1 font-mono text-xs text-zinc-600">
                          {gap.createdArticleId}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
