"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface MarketplaceListing {
  pluginId: string;
  manifest: {
    name: string;
    version: string;
    description: string;
    author: string;
    category?: string;
    icon?: string;
    permissions: string[];
    hooks: string[];
  };
  status: string;
  installCount: number;
  averageRating: number | null;
  reviewCount: number;
  featured: boolean;
}

const CATEGORIES = [
  "All",
  "Communication",
  "CRM",
  "Developer Tools",
  "Analytics",
  "Productivity",
];

export default function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [installing, setInstalling] = useState<string | null>(null);

  const loadListings = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category !== "All") params.set("category", category);
      const res = await fetch(`/api/marketplace?${params}`);
      const data = await res.json();
      setListings(data.listings || []);
    } catch {
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  async function handleInstall(pluginId: string) {
    setInstalling(pluginId);
    try {
      const res = await fetch(`/api/marketplace/${pluginId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await loadListings();
      }
    } finally {
      setInstalling(null);
    }
  }

  function renderStars(rating: number | null) {
    if (!rating) return "No ratings";
    const full = Math.round(rating);
    return Array.from({ length: 5 }, (_, i) => (i < full ? "\u2605" : "\u2606")).join("");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Plugin Marketplace</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Extend CLIaaS with integrations and automations
          </p>
        </div>
        <Link
          href="/integrations"
          className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
        >
          My Plugins
        </Link>
      </div>

      {/* Search + Category Filters */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`border px-3 py-1.5 font-mono text-xs font-bold uppercase transition-colors ${
                category === cat
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-500"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading marketplace...</p>
        </div>
      ) : listings.length === 0 ? (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No plugins found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Try a different search or category.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <div
              key={listing.pluginId}
              className="flex flex-col border-2 border-zinc-950 bg-white"
            >
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold">{listing.manifest.name}</h3>
                    <p className="font-mono text-xs text-zinc-400">
                      v{listing.manifest.version} by {listing.manifest.author}
                    </p>
                  </div>
                  {listing.featured && (
                    <span className="border border-amber-400 bg-amber-50 px-2 py-0.5 font-mono text-xs font-bold uppercase text-amber-700">
                      Featured
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-zinc-600 line-clamp-2">
                  {listing.manifest.description}
                </p>
                <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
                  <span className="font-mono">
                    {renderStars(listing.averageRating)}{" "}
                    ({listing.reviewCount})
                  </span>
                  <span className="font-mono">
                    {listing.installCount} installs
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3">
                <Link
                  href={`/marketplace/${listing.pluginId}`}
                  className="font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950"
                >
                  Details
                </Link>
                <button
                  onClick={() => handleInstall(listing.pluginId)}
                  disabled={installing === listing.pluginId}
                  className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                >
                  {installing === listing.pluginId ? "Installing..." : "Install"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
