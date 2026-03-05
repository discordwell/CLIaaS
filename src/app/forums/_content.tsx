"use client";

import { useEffect, useState, useCallback } from "react";

interface ForumCategory {
  id: string;
  name: string;
  description?: string;
  slug: string;
  position: number;
  createdAt: string;
}

interface ForumThread {
  id: string;
  categoryId: string;
  title: string;
  body: string;
  status: "open" | "closed" | "pinned";
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  lastActivityAt: string;
  convertedTicketId?: string;
  createdAt: string;
}

export default function ForumsContent() {
  const [categories, setCategories] = useState<ForumCategory[]>([]);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSlug, setNewCatSlug] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [catRes, threadRes] = await Promise.all([
        fetch("/api/forums/categories"),
        fetch(
          activeCategory
            ? `/api/forums/threads?categoryId=${activeCategory}`
            : "/api/forums/threads"
        ),
      ]);
      const catData = await catRes.json();
      const threadData = await threadRes.json();
      setCategories(catData.categories ?? []);
      setThreads(threadData.threads ?? []);
    } catch {
      setCategories([]);
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim() || !newCatSlug.trim()) return;

    await fetch("/api/forums/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCatName.trim(),
        slug: newCatSlug.trim(),
        description: newCatDesc.trim() || undefined,
        position: categories.length,
      }),
    });

    setNewCatName("");
    setNewCatSlug("");
    setNewCatDesc("");
    setShowNewCategory(false);
    loadData();
  }

  async function handleDeleteCategory(id: string) {
    await fetch(`/api/forums/categories/${id}`, { method: "DELETE" });
    if (activeCategory === id) setActiveCategory(null);
    loadData();
  }

  async function handleModerate(threadId: string, action: "close" | "pin" | "unpin") {
    await fetch(`/api/forums/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    loadData();
  }

  const threadCountForCategory = (catId: string) =>
    threads.filter((t) => t.categoryId === catId).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Community Forums
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {categories.length} categor{categories.length !== 1 ? "ies" : "y"}
            </h1>
          </div>
          <button
            onClick={() => setShowNewCategory(true)}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Category
          </button>
        </div>
      </header>

      {/* New category form */}
      {showNewCategory && (
        <form
          onSubmit={handleCreateCategory}
          className="mt-8 border-2 border-zinc-950 bg-white p-6"
        >
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            New Category
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Name
              </label>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => {
                  setNewCatName(e.target.value);
                  setNewCatSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                  );
                }}
                placeholder="e.g. General Discussion"
                className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Slug
              </label>
              <input
                type="text"
                value={newCatSlug}
                onChange={(e) => setNewCatSlug(e.target.value)}
                placeholder="e.g. general-discussion"
                className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Description
            </label>
            <input
              type="text"
              value={newCatDesc}
              onChange={(e) => setNewCatDesc(e.target.value)}
              placeholder="Optional description"
              className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewCategory(false)}
              className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </section>
      ) : (
        <>
          {/* Categories */}
          {categories.length > 0 && (
            <section className="mt-8 border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
                <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Categories
                </p>
              </div>
              <div className="divide-y divide-zinc-200">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`flex items-center justify-between p-5 cursor-pointer transition-colors ${
                      activeCategory === cat.id
                        ? "bg-zinc-50"
                        : "hover:bg-zinc-50"
                    }`}
                    onClick={() =>
                      setActiveCategory(
                        activeCategory === cat.id ? null : cat.id
                      )
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{cat.name}</p>
                      {cat.description && (
                        <p className="mt-1 text-xs text-zinc-500">
                          {cat.description}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-xs text-zinc-400">
                        /{cat.slug} · {threadCountForCategory(cat.id)} thread
                        {threadCountForCategory(cat.id) !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCategory(cat.id);
                      }}
                      className="ml-4 shrink-0 px-3 py-1 font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Threads */}
          <section className="mt-8 border-2 border-zinc-950 bg-white">
            <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
              <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                {activeCategory
                  ? `Threads in ${categories.find((c) => c.id === activeCategory)?.name ?? "..."}`
                  : "All Threads"}
              </p>
            </div>
            {threads.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-zinc-500">No threads found.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200">
                {threads.map((thread) => (
                  <div key={thread.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
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
                          {thread.convertedTicketId && (
                            <span className="shrink-0 bg-blue-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-blue-700">
                              Ticket
                            </span>
                          )}
                          <p className="truncate text-sm font-bold">
                            {thread.title}
                          </p>
                        </div>
                        <p className="mt-1 font-mono text-xs text-zinc-500">
                          {thread.replyCount} repl
                          {thread.replyCount !== 1 ? "ies" : "y"} ·{" "}
                          {thread.viewCount} view
                          {thread.viewCount !== 1 ? "s" : ""} · Last activity{" "}
                          {new Date(thread.lastActivityAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {thread.status !== "closed" && (
                          <button
                            onClick={() => handleModerate(thread.id, "close")}
                            className="px-2 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
                          >
                            Close
                          </button>
                        )}
                        {thread.isPinned ? (
                          <button
                            onClick={() => handleModerate(thread.id, "unpin")}
                            className="px-2 py-1 font-mono text-xs font-bold uppercase text-amber-600 hover:text-amber-800"
                          >
                            Unpin
                          </button>
                        ) : (
                          <button
                            onClick={() => handleModerate(thread.id, "pin")}
                            className="px-2 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
                          >
                            Pin
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
