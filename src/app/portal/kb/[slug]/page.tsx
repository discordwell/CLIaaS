"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface PortalArticle {
  id: string;
  title: string;
  body: string;
  categoryPath: string[];
  locale: string;
  slug: string;
  metaTitle?: string;
  metaDescription?: string;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
}

export default function PortalArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<PortalArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackSent, setFeedbackSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/kb/${encodeURIComponent(slug)}`);
        if (res.ok) {
          const data = await res.json();
          setArticle(data.article);
        }
      } catch {
        // Failed to load
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  async function submitFeedback(helpful: boolean) {
    if (!article || feedbackSent) return;
    setFeedbackSent(true);
    try {
      await fetch(`/api/portal/kb/${article.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helpful }),
      });
    } catch {
      // Best effort
    }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
        <p className="font-mono text-sm text-zinc-500">Loading article...</p>
      </main>
    );
  }

  if (!article) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
        <p className="text-lg font-bold">Article not found</p>
        <Link href="/portal/kb" className="mt-4 inline-block font-mono text-xs underline">
          Back to Knowledge Base
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/portal" className="hover:underline">Portal</Link>
        <span>/</span>
        <Link href="/portal/kb" className="hover:underline">KB</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">{article.title}</span>
      </nav>

      <article className="border-2 border-zinc-950 bg-white">
        <header className="border-b-2 border-zinc-950 p-8">
          <h1 className="text-2xl font-bold">{article.metaTitle || article.title}</h1>
          <div className="mt-2 flex items-center gap-3 font-mono text-xs text-zinc-500">
            <span>{article.categoryPath?.join(" / ")}</span>
            <span className="border border-zinc-300 px-1.5 py-0.5 uppercase">{article.locale}</span>
          </div>
        </header>

        <div className="prose max-w-none p-8 text-sm leading-relaxed text-zinc-700">
          {article.body.split("\n").map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        <footer className="border-t-2 border-zinc-950 p-6">
          <p className="mb-3 font-mono text-xs font-bold uppercase text-zinc-600">
            Was this article helpful?
          </p>
          {feedbackSent ? (
            <p className="font-mono text-xs text-green-700">Thanks for your feedback!</p>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => submitFeedback(true)}
                className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase transition-colors hover:bg-zinc-950 hover:text-white"
              >
                Yes, helpful
              </button>
              <button
                onClick={() => submitFeedback(false)}
                className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500 transition-colors hover:border-zinc-950 hover:text-zinc-950"
              >
                Not helpful
              </button>
            </div>
          )}
        </footer>
      </article>
    </main>
  );
}
