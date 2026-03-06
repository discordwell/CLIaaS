"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SuggestedArticle {
  id: string;
  title: string;
  snippet: string;
  score: number;
  categoryPath: string[];
}

interface DeflectionPanelProps {
  query: string;
}

export default function DeflectionPanel({ query }: DeflectionPanelProps) {
  const [articles, setArticles] = useState<SuggestedArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBody, setExpandedBody] = useState<string>("");
  const [loadingBody, setLoadingBody] = useState(false);
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");

  const trackImpression = useCallback(
    async (articleId: string, searchQuery: string) => {
      if (trackedIds.has(articleId)) return;
      setTrackedIds((prev) => new Set(prev).add(articleId));

      try {
        await fetch("/api/portal/kb/deflection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleId,
            query: searchQuery,
            source: "portal",
            deflected: false,
          }),
        });
      } catch {
        // Silently fail
      }
    },
    [trackedIds],
  );

  const trackDeflection = useCallback(
    async (articleId: string, searchQuery: string) => {
      try {
        await fetch("/api/portal/kb/deflection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleId,
            query: searchQuery,
            source: "portal",
            deflected: true,
          }),
        });
      } catch {
        // Silently fail
      }
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 5) {
      setArticles([]);
      return;
    }

    if (trimmed === lastQueryRef.current) return;

    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = trimmed;
      setLoading(true);

      try {
        const res = await fetch("/api/portal/kb/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });

        if (res.ok) {
          const data = await res.json();
          setArticles(data.articles ?? []);
          setExpandedId(null);
          setExpandedBody("");
          setTrackedIds(new Set());
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleExpand = async (article: SuggestedArticle) => {
    if (expandedId === article.id) {
      setExpandedId(null);
      setExpandedBody("");
      return;
    }

    setExpandedId(article.id);
    trackImpression(article.id, lastQueryRef.current);
    trackDeflection(article.id, lastQueryRef.current);

    // Fetch full article body
    setLoadingBody(true);
    try {
      const res = await fetch(`/api/portal/kb?q=${encodeURIComponent(article.title)}`);
      if (res.ok) {
        const data = await res.json();
        const match = data.articles?.find(
          (a: { id: string }) => a.id === article.id,
        );
        setExpandedBody(match?.body ?? article.snippet);
      } else {
        setExpandedBody(article.snippet);
      }
    } catch {
      setExpandedBody(article.snippet);
    } finally {
      setLoadingBody(false);
    }
  };

  if (articles.length === 0 && !loading) return null;

  return (
    <div className="border-2 border-zinc-950 bg-zinc-50 p-6">
      <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
        Related Articles
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        These articles might answer your question.
      </p>

      {loading && (
        <p className="mt-4 font-mono text-xs text-zinc-400">Searching...</p>
      )}

      <div className="mt-4 space-y-3">
        {articles.map((article) => (
          <div
            key={article.id}
            className="border-2 border-zinc-950 bg-white"
          >
            <button
              type="button"
              onClick={() => handleExpand(article)}
              className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-zinc-50"
            >
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-zinc-950">
                  {article.title}
                </h4>
                {expandedId !== article.id && (
                  <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                    {article.snippet}
                  </p>
                )}
                <p className="mt-1 font-mono text-[10px] text-zinc-400">
                  {article.categoryPath.join(" / ")}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-zinc-400">
                {expandedId === article.id ? "[-]" : "[+]"}
              </span>
            </button>

            {expandedId === article.id && (
              <div className="border-t-2 border-zinc-950 p-4">
                {loadingBody ? (
                  <p className="font-mono text-xs text-zinc-400">Loading...</p>
                ) : (
                  <div className="prose prose-sm max-w-none text-zinc-700">
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {expandedBody}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
