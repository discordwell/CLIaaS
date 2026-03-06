"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ArticleStat {
  id: string;
  title: string;
  helpfulCount: number;
  notHelpfulCount: number;
  viewCount: number;
}

interface Analytics {
  totalFeedback: number;
  totalHelpful: number;
  totalNotHelpful: number;
  topHelpful: ArticleStat[];
  topUnhelpful: ArticleStat[];
  deflections: {
    total: number;
    successful: number;
    rate: number;
  };
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {subtitle && (
        <p className="mt-1 font-mono text-xs text-zinc-400">{subtitle}</p>
      )}
    </div>
  );
}

function ArticleTable({
  title,
  articles,
  emptyMessage,
}: {
  title: string;
  articles: ArticleStat[];
  emptyMessage: string;
}) {
  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="border-b-2 border-zinc-950 bg-zinc-50 px-6 py-4">
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {articles.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-zinc-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-200">
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px] gap-4 px-6 py-3">
            <span className="font-mono text-[10px] font-bold uppercase text-zinc-500">
              Article
            </span>
            <span className="text-right font-mono text-[10px] font-bold uppercase text-zinc-500">
              Helpful
            </span>
            <span className="text-right font-mono text-[10px] font-bold uppercase text-zinc-500">
              Not Helpful
            </span>
            <span className="text-right font-mono text-[10px] font-bold uppercase text-zinc-500">
              Views
            </span>
          </div>
          {articles.map((a) => {
            const total = a.helpfulCount + a.notHelpfulCount;
            const ratio =
              total > 0
                ? Math.round((a.helpfulCount / total) * 100)
                : 0;
            return (
              <div
                key={a.id}
                className="grid grid-cols-[1fr_80px_80px_80px] items-center gap-4 px-6 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{a.title}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                    {ratio}% helpful
                  </p>
                </div>
                <p className="text-right font-mono text-sm font-bold text-emerald-600">
                  {a.helpfulCount}
                </p>
                <p className="text-right font-mono text-sm font-bold text-red-500">
                  {a.notHelpfulCount}
                </p>
                <p className="text-right font-mono text-sm text-zinc-600">
                  {a.viewCount}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KBAnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/kb/feedback/analytics");
        if (res.ok) {
          setAnalytics(await res.json());
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
          <span className="font-bold text-zinc-950">Analytics</span>
        </nav>
        <h1 className="text-3xl font-bold">KB Analytics</h1>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          View counts, article feedback, and deflection rates across your
          knowledge base.
        </p>
      </header>

      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">
            Loading analytics...
          </p>
        </div>
      ) : !analytics ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No analytics data available</p>
          <p className="mt-2 text-sm text-zinc-600">
            Analytics require a connected database with article feedback data.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Total Feedback"
              value={analytics.totalFeedback}
            />
            <StatCard
              label="Helpful"
              value={analytics.totalHelpful}
              subtitle={
                analytics.totalFeedback > 0
                  ? `${Math.round(
                      (analytics.totalHelpful / analytics.totalFeedback) * 100,
                    )}% of total`
                  : undefined
              }
            />
            <StatCard
              label="Not Helpful"
              value={analytics.totalNotHelpful}
            />
            <StatCard
              label="Deflection Rate"
              value={`${analytics.deflections.rate}%`}
              subtitle={`${analytics.deflections.successful} of ${analytics.deflections.total} impressions`}
            />
          </div>

          {/* Top helpful articles */}
          <div className="mt-8">
            <ArticleTable
              title="Most Helpful Articles"
              articles={analytics.topHelpful}
              emptyMessage="No feedback data yet."
            />
          </div>

          {/* Top unhelpful articles */}
          <div className="mt-8">
            <ArticleTable
              title="Needs Improvement"
              articles={analytics.topUnhelpful}
              emptyMessage="No negative feedback yet."
            />
          </div>

          {/* Quick links */}
          <div className="mt-8 border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Quick Actions</h2>
            <div className="mt-4 flex gap-4">
              <Link
                href="/kb/content-gaps"
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800"
              >
                View Content Gaps
              </Link>
              <Link
                href="/kb"
                className="border-2 border-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
              >
                Browse Articles
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
