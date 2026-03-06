"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: string[];
  permissions: string[];
  actions: Array<{ id: string; name: string; description: string }>;
  uiSlots: Array<{ location: string; component: string }>;
  runtime: string;
  category?: string;
}

interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
}

interface Listing {
  pluginId: string;
  manifest: PluginManifest;
  status: string;
  installCount: number;
  averageRating: number | null;
  reviewCount: number;
  featured: boolean;
}

type DetailTab = "overview" | "reviews";

export default function MarketplaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pluginId = params.pluginId as string;

  const [listing, setListing] = useState<Listing | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [installing, setInstalling] = useState(false);

  // Review form
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [listingRes, reviewsRes] = await Promise.all([
        fetch(`/api/marketplace/${pluginId}`),
        fetch(`/api/marketplace/${pluginId}/reviews`),
      ]);
      if (listingRes.ok) {
        const data = await listingRes.json();
        setListing(data.listing);
      }
      if (reviewsRes.ok) {
        const data = await reviewsRes.json();
        setReviews(data.reviews || []);
      }
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleInstall() {
    setInstalling(true);
    try {
      const res = await fetch(`/api/marketplace/${pluginId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        router.push("/integrations");
      }
    } finally {
      setInstalling(false);
    }
  }

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingReview(true);
    try {
      await fetch(`/api/marketplace/${pluginId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: reviewRating,
          title: reviewTitle,
          body: reviewBody,
        }),
      });
      setReviewTitle("");
      setReviewBody("");
      await loadData();
    } finally {
      setSubmittingReview(false);
    }
  }

  function renderStars(n: number) {
    return Array.from({ length: 5 }, (_, i) => (i < n ? "\u2605" : "\u2606")).join("");
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">Plugin not found</p>
          <Link
            href="/marketplace"
            className="mt-4 inline-block font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950"
          >
            Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  const m = listing.manifest;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Breadcrumb */}
      <Link
        href="/marketplace"
        className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
      >
        Marketplace
      </Link>

      {/* Header */}
      <div className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{m.name}</h1>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              v{m.version} by {m.author} | {m.runtime} runtime
            </p>
            <p className="mt-2 text-sm text-zinc-600">{m.description}</p>
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
              <span className="font-mono">
                {renderStars(Math.round(listing.averageRating ?? 0))}{" "}
                ({listing.reviewCount} reviews)
              </span>
              <span className="font-mono">{listing.installCount} installs</span>
            </div>
          </div>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {installing ? "Installing..." : "Install"}
          </button>
        </div>

        {/* Permissions */}
        <div className="mt-4">
          <span className="font-mono text-xs font-bold uppercase text-zinc-500">
            Permissions Required
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {m.permissions.map((p) => (
              <span
                key={p}
                className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1">
        {(["overview", "reviews"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
              tab === t
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="mt-4 space-y-4">
          {/* Hooks */}
          <section className="border-2 border-zinc-950 bg-white p-4">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Event Hooks
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {m.hooks.map((hook) => (
                <span
                  key={hook}
                  className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
                >
                  {hook}
                </span>
              ))}
            </div>
          </section>

          {/* Actions */}
          {m.actions.length > 0 && (
            <section className="border-2 border-zinc-950 bg-white p-4">
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                Actions
              </span>
              <div className="mt-2 space-y-2">
                {m.actions.map((action) => (
                  <div key={action.id} className="border border-zinc-200 p-3">
                    <p className="font-mono text-xs font-bold">{action.name}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {action.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* UI Slots */}
          {m.uiSlots.length > 0 && (
            <section className="border-2 border-zinc-950 bg-white p-4">
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                UI Extensions
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {m.uiSlots.map((slot, i) => (
                  <span
                    key={i}
                    className="border border-blue-300 bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700"
                  >
                    {slot.location}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Reviews Tab */}
      {tab === "reviews" && (
        <div className="mt-4 space-y-4">
          {/* Submit Review */}
          <section className="border-2 border-zinc-950 bg-white p-4">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Write a Review
            </span>
            <form onSubmit={handleReview} className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-zinc-500">Rating:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReviewRating(n)}
                    className={`text-lg ${n <= reviewRating ? "text-amber-500" : "text-zinc-300"}`}
                  >
                    {"\u2605"}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Title"
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
              />
              <textarea
                placeholder="Your review..."
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={3}
                className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submittingReview}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {submittingReview ? "Submitting..." : "Submit Review"}
              </button>
            </form>
          </section>

          {/* Reviews List */}
          {reviews.length === 0 ? (
            <div className="border-2 border-zinc-950 bg-white p-6 text-center">
              <p className="text-sm text-zinc-500">
                No reviews yet. Be the first!
              </p>
            </div>
          ) : (
            reviews.map((review) => (
              <div
                key={review.id}
                className="border-2 border-zinc-950 bg-white p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-amber-500">
                    {renderStars(review.rating)}
                  </span>
                  <span className="font-bold text-sm">{review.title}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-600">{review.body}</p>
                <p className="mt-2 font-mono text-xs text-zinc-400">
                  {new Date(review.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
