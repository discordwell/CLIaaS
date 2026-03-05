"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface CategoryInfo {
  id: string;
  name: string;
  description?: string;
  slug: string;
}

interface ThreadSummary {
  id: string;
  title: string;
  status: "open" | "closed" | "pinned";
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  lastActivityAt: string;
  createdAt: string;
}

export default function PortalCategoryPage() {
  const params = useParams<{ categorySlug: string }>();
  const [category, setCategory] = useState<CategoryInfo | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/portal/forums/${encodeURIComponent(params.categorySlug)}`
        );
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setCategory(data.category);
        setThreads(data.threads ?? []);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.categorySlug]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </div>
      </main>
    );
  }

  if (notFound || !category) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">Category not found</p>
          <Link
            href="/portal/forums"
            className="mt-4 inline-block font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
          >
            Back to forums
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <Link
          href="/portal/forums"
          className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
        >
          Forums
        </Link>
        <h1 className="mt-4 text-3xl font-bold">{category.name}</h1>
        {category.description && (
          <p className="mt-2 text-sm text-zinc-600">{category.description}</p>
        )}
      </header>

      {threads.length === 0 ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No threads yet</p>
          <p className="mt-2 text-sm text-zinc-600">
            Be the first to start a discussion in this category.
          </p>
        </div>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="divide-y divide-zinc-200">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/portal/forums/thread/${thread.id}`}
                className="flex items-center justify-between p-5 transition-colors hover:bg-zinc-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {thread.isPinned && (
                      <span className="shrink-0 bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-700">
                        Pinned
                      </span>
                    )}
                    {thread.status === "closed" && (
                      <span className="shrink-0 bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-600">
                        Closed
                      </span>
                    )}
                    <p className="truncate text-sm font-bold">{thread.title}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {thread.replyCount} repl
                    {thread.replyCount !== 1 ? "ies" : "y"} ·{" "}
                    {thread.viewCount} view
                    {thread.viewCount !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="ml-4 shrink-0 font-mono text-xs text-zinc-400">
                  {new Date(thread.lastActivityAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
