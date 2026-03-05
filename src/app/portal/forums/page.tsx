"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ForumCategorySummary {
  id: string;
  name: string;
  description?: string;
  slug: string;
  threadCount: number;
}

export default function PortalForumsPage() {
  const [categories, setCategories] = useState<ForumCategorySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portal/forums");
        const data = await res.json();
        setCategories(data.categories ?? []);
      } catch {
        setCategories([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-indigo-500"></div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Community
          </p>
        </div>
        <h1 className="mt-4 text-3xl font-bold">Forums</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Browse discussions, ask questions, and share your experience.
        </p>
      </header>

      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading forums...</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No forum categories</p>
          <p className="mt-2 text-sm text-zinc-600">
            No discussion categories are available yet. Check back soon.
          </p>
        </div>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="divide-y divide-zinc-200">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/portal/forums/${cat.slug}`}
                className="flex items-center justify-between p-6 transition-colors hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">{cat.name}</p>
                  {cat.description && (
                    <p className="mt-1 text-sm text-zinc-600">
                      {cat.description}
                    </p>
                  )}
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className="text-2xl font-bold">{cat.threadCount}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    thread{cat.threadCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 border-2 border-zinc-950 bg-white p-6 text-center">
        <p className="text-sm text-zinc-600">
          Need help?{" "}
          <Link
            href="/portal/tickets/new"
            className="font-bold text-zinc-950 underline hover:no-underline"
          >
            Submit a ticket
          </Link>{" "}
          for direct support.
        </p>
      </div>
    </main>
  );
}
