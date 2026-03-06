"use client";

import { useState, useCallback } from "react";

interface ArticleEditorProps {
  /** Existing article ID (if editing); omit for new article creation. */
  articleId?: string;
  initialData?: {
    title?: string;
    body?: string;
    locale?: string;
    slug?: string;
    metaTitle?: string;
    metaDescription?: string;
  };
  onSaved?: (article: { id: string }) => void;
}

const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
  { value: "ko", label: "Korean" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
];

export default function ArticleEditor({
  articleId,
  initialData,
  onSaved,
}: ArticleEditorProps) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [body, setBody] = useState(initialData?.body ?? "");
  const [locale, setLocale] = useState(initialData?.locale ?? "en");
  const [slug, setSlug] = useState(initialData?.slug ?? "");
  const [metaTitle, setMetaTitle] = useState(initialData?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(
    initialData?.metaDescription ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const autoSlug = useCallback(
    (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, ""),
    []
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    // Auto-generate slug from title if slug is empty or was auto-generated
    if (!slug || slug === autoSlug(title)) {
      setSlug(autoSlug(val));
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        locale,
        slug: slug.trim() || undefined,
        metaTitle: metaTitle.trim() || undefined,
        metaDescription: metaDescription.trim() || undefined,
      };

      const url = articleId ? `/api/kb/${articleId}` : "/api/kb";
      const method = articleId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const data = await res.json();
      setSuccess(true);
      onSaved?.(data.article ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="border-b-2 border-zinc-950 bg-zinc-50 p-6">
        <h2 className="text-xl font-bold">
          {articleId ? "Edit Article" : "New Article"}
        </h2>
      </div>

      <div className="space-y-6 p-6">
        {/* Title */}
        <div>
          <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Article title..."
            className="w-full border-2 border-zinc-950 px-4 py-2 text-sm focus:outline-none"
          />
        </div>

        {/* Body */}
        <div>
          <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Article content..."
            rows={16}
            className="w-full border-2 border-zinc-950 px-4 py-3 text-sm leading-relaxed focus:outline-none"
          />
        </div>

        {/* Locale */}
        <div>
          <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
            Locale
          </label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="border-2 border-zinc-950 px-4 py-2 text-sm focus:outline-none"
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
        </div>

        {/* SEO Section */}
        <div className="border-t-2 border-zinc-200 pt-6">
          <p className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            SEO Fields
          </p>

          {/* Slug */}
          <div className="mb-4">
            <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="article-url-slug"
              className="w-full border-2 border-zinc-950 px-4 py-2 text-sm focus:outline-none"
            />
            <p className="mt-1 font-mono text-xs text-zinc-400">
              URL path: /portal/kb/{slug || "..."}
            </p>
          </div>

          {/* Meta Title */}
          <div className="mb-4">
            <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
              Meta Title
            </label>
            <input
              type="text"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              placeholder={title || "Page title for search engines..."}
              className="w-full border-2 border-zinc-950 px-4 py-2 text-sm focus:outline-none"
            />
            <p className="mt-1 font-mono text-xs text-zinc-400">
              {metaTitle.length}/60 characters
            </p>
          </div>

          {/* Meta Description */}
          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
              Meta Description
            </label>
            <textarea
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              placeholder="Brief description for search results..."
              rows={3}
              className="w-full border-2 border-zinc-950 px-4 py-3 text-sm focus:outline-none"
            />
            <p className="mt-1 font-mono text-xs text-zinc-400">
              {metaDescription.length}/160 characters
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 border-t-2 border-zinc-200 pt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="border-2 border-zinc-950 bg-zinc-950 px-8 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : articleId ? "Update Article" : "Create Article"}
          </button>

          {error && (
            <p className="font-mono text-xs font-bold text-red-600">{error}</p>
          )}
          {success && (
            <p className="font-mono text-xs font-bold text-green-600">
              Saved successfully.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
