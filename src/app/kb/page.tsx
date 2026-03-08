"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useDensity } from "@/components/DensityProvider";
import DensityToggle from "@/components/DensityToggle";

interface KBArticle {
  id: string;
  title: string;
  body: string;
  categoryPath: string[];
  status: string;
  updatedAt: string;
  locale?: string;
  brandId?: string;
  visibility?: string;
  slug?: string;
  parentArticleId?: string;
  helpfulCount?: number;
  notHelpfulCount?: number;
  viewCount?: number;
}

const LOCALE_OPTIONS = [
  { value: "", label: "All Locales" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];

const VISIBILITY_OPTIONS = [
  { value: "", label: "All Visibility" },
  { value: "public", label: "Public" },
  { value: "internal", label: "Internal" },
  { value: "draft", label: "Draft" },
];

const articlePadding = {
  spacious: "p-8",
  comfortable: "p-6",
  compact: "p-3",
} as const;

const articleTitleSize = {
  spacious: "text-lg",
  comfortable: "text-lg",
  compact: "text-sm",
} as const;

const articleBodyHeight = {
  spacious: "max-h-40",
  comfortable: "max-h-40",
  compact: "max-h-16",
} as const;

export default function KBPage() {
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState("");
  const [brandId, setBrandId] = useState("");
  const [visibility, setVisibility] = useState("");
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const { density } = useDensity();

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (locale) params.set("locale", locale);
      if (brandId) params.set("brandId", brandId);
      if (visibility) params.set("visibility", visibility);

      const res = await fetch(`/api/kb?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [locale, brandId, visibility]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  // Load brands for filter
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brands");
        if (res.ok) {
          const data = await res.json();
          setBrands(data.brands ?? []);
        }
      } catch {
        // No brands available
      }
    })();
  }, []);

  // Group by top-level category
  const categories: Record<string, KBArticle[]> = {};
  for (const article of articles) {
    const cat = article.categoryPath?.[0] ?? "Uncategorized";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(article);
  }

  // Collect all locales present in articles
  const articleLocales = new Set(articles.map((a) => a.locale).filter(Boolean));

  // Translation status helper
  const getTranslationBadge = (article: KBArticle) => {
    if (article.parentArticleId) {
      return (
        <span className="border border-blue-400 bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold uppercase text-blue-600">
          translation
        </span>
      );
    }
    // Check if there are translations for this article
    const translations = articles.filter(
      (a) => a.parentArticleId === article.id
    );
    if (translations.length > 0) {
      return (
        <span className="border border-green-400 bg-green-50 px-2 py-0.5 font-mono text-xs font-bold uppercase text-green-700">
          {translations.length} translation{translations.length !== 1 ? "s" : ""}
        </span>
      );
    }
    return null;
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Knowledge Base</span>
        </nav>
        <h1 className="text-3xl font-bold">
          Knowledge Base ({articles.length} article
          {articles.length !== 1 ? "s" : ""})
        </h1>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          Articles exported from your helpdesk. Use{" "}
          <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
            cliaas kb suggest --ticket &lt;id&gt;
          </code>{" "}
          to surface relevant articles for a ticket.
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <DensityToggle />
          <span className="mx-1 self-center text-zinc-300">|</span>
          {/* Locale filter */}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="border-2 border-zinc-950 px-3 py-1.5 font-mono text-xs focus:outline-none"
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Brand filter */}
          {brands.length > 0 && (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="border-2 border-zinc-950 px-3 py-1.5 font-mono text-xs focus:outline-none"
            >
              <option value="">All Brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Visibility filter */}
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="border-2 border-zinc-950 px-3 py-1.5 font-mono text-xs focus:outline-none"
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Locale badges showing present locales */}
          {articleLocales.size > 1 && (
            <div className="ml-auto flex gap-1">
              {Array.from(articleLocales)
                .sort()
                .map((l) => (
                  <span
                    key={l}
                    className="border border-zinc-300 px-2 py-0.5 font-mono text-xs uppercase text-zinc-500"
                  >
                    {l}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Navigation links */}
        <div className="mt-4 flex gap-4">
          <Link
            href="/kb/content-gaps"
            className="font-mono text-xs font-bold uppercase text-zinc-600 underline hover:text-zinc-950"
          >
            Content Gaps
          </Link>
          <Link
            href="/kb/analytics"
            className="font-mono text-xs font-bold uppercase text-zinc-600 underline hover:text-zinc-950"
          >
            Analytics
          </Link>
        </div>
      </header>

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">
            Loading articles...
          </p>
        </section>
      ) : articles.length === 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No KB articles found</p>
          <p className="mt-2 text-sm text-zinc-600">
            {locale || brandId || visibility
              ? "Try adjusting your filters."
              : (
                  <>
                    Generate demo data:{" "}
                    <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
                      cliaas demo --tickets 50
                    </code>
                  </>
                )}
          </p>
        </section>
      ) : (
        Object.entries(categories).map(([category, catArticles]) => (
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
                <div key={article.id} className={articlePadding[density]}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className={`${articleTitleSize[density]} font-bold`}>{article.title}</h3>
                      <div className={`${density === "compact" ? "mt-0.5" : "mt-1"} flex items-center gap-2`}>
                        <span className={`font-mono ${density === "compact" ? "text-[10px]" : "text-xs"} text-zinc-500`}>
                          {article.categoryPath?.join(" / ")}
                        </span>
                        {article.locale && (
                          <span className={`border border-zinc-300 font-mono uppercase text-zinc-500 ${density === "compact" ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-xs"}`}>
                            {article.locale}
                          </span>
                        )}
                        {article.visibility && article.visibility !== "public" && (
                          <span className={`border border-amber-400 bg-amber-50 font-mono font-bold uppercase text-amber-700 ${density === "compact" ? "px-1 py-0 text-[9px]" : "px-1.5 py-0.5 text-xs"}`}>
                            {article.visibility}
                          </span>
                        )}
                        {getTranslationBadge(article)}
                      </div>
                    </div>
                    {density !== "compact" && (
                      <span className="shrink-0 font-mono text-xs text-zinc-400">
                        {article.id}
                      </span>
                    )}
                  </div>
                  <div className={`${density === "compact" ? "mt-1" : "mt-4"} ${articleBodyHeight[density]} overflow-hidden ${density === "compact" ? "text-xs" : "text-sm"} leading-relaxed text-zinc-600`}>
                    {article.body.slice(0, density === "compact" ? 200 : 500)}
                    {article.body.length > (density === "compact" ? 200 : 500) && "..."}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
