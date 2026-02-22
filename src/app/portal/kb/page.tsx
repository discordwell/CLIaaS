"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface KBArticle {
  id: string;
  title: string;
  body: string;
  categoryPath: string[];
  snippet: string;
}

export default function PortalKBPage() {
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  useEffect(() => {
    loadArticles();
  }, []);

  async function loadArticles(q?: string, cat?: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cat) params.set("category", cat);

      const res = await fetch(`/api/portal/kb?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        setArticles(data.articles ?? []);
        if (data.categories) setCategories(data.categories);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadArticles(query, activeCategory);
  };

  const onCategoryClick = (cat: string) => {
    const newCat = activeCategory === cat ? "" : cat;
    setActiveCategory(newCat);
    loadArticles(query, newCat);
  };

  // Group articles by top-level category
  const grouped: Record<string, KBArticle[]> = {};
  for (const article of articles) {
    const cat = article.categoryPath[0] ?? "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(article);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-blue-500"></div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Knowledge Base
          </p>
        </div>
        <h1 className="mt-4 text-3xl font-bold">
          Find Answers
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Browse articles and search for solutions to common questions.
        </p>

        {/* Search */}
        <form onSubmit={onSearch} className="mt-6 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles..."
            className="flex-1 border-2 border-zinc-950 px-4 py-2 text-sm focus:outline-none"
          />
          <button
            type="submit"
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Search
          </button>
        </form>

        {/* Category filters */}
        {categories.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => onCategoryClick(cat)}
                className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                  activeCategory === cat
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </header>

      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading articles...</p>
        </div>
      ) : articles.length === 0 ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No articles found</p>
          <p className="mt-2 text-sm text-zinc-600">
            {query
              ? "Try a different search term."
              : "No knowledge base articles are available yet."}
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, catArticles]) => (
          <section
            key={category}
            className="mt-8 border-2 border-zinc-950 bg-white"
          >
            <div className="border-b-2 border-zinc-950 bg-zinc-50 p-6">
              <h2 className="text-xl font-bold">{category}</h2>
              <p className="font-mono text-xs text-zinc-500">
                {catArticles.length} article
                {catArticles.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="divide-y divide-zinc-200">
              {catArticles.map((article) => (
                <div key={article.id} className="p-6">
                  <button
                    onClick={() =>
                      setExpandedArticle(
                        expandedArticle === article.id ? null : article.id
                      )
                    }
                    className="flex w-full items-start justify-between text-left"
                  >
                    <div>
                      <h3 className="text-lg font-bold hover:underline">
                        {article.title}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-zinc-500">
                        {article.categoryPath.join(" / ")}
                      </p>
                    </div>
                    <span className="ml-4 shrink-0 font-mono text-xs text-zinc-400">
                      {expandedArticle === article.id ? "collapse" : "expand"}
                    </span>
                  </button>
                  {expandedArticle === article.id ? (
                    <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                      {article.body}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-500">
                      {article.snippet}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {/* Help link */}
      <div className="mt-8 border-2 border-zinc-950 bg-white p-6 text-center">
        <p className="text-sm text-zinc-600">
          Cannot find what you are looking for?{" "}
          <Link
            href="/portal/tickets/new"
            className="font-bold text-zinc-950 underline hover:no-underline"
          >
            Submit a ticket
          </Link>{" "}
          and we will help you out.
        </p>
      </div>
    </main>
  );
}
