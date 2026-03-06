"use client";

import { useEffect, useState, useCallback } from "react";

interface InAppMessage {
  id: string;
  name: string;
  messageType: "banner" | "modal" | "tooltip" | "slide_in";
  title: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  targetUrlPattern: string;
  isActive: boolean;
  priority: number;
  maxImpressions: number;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  banner: "Banner",
  modal: "Modal",
  tooltip: "Tooltip",
  slide_in: "Slide-in",
};

export default function MessagesPageContent() {
  const [messages, setMessages] = useState<InAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    messageType: "banner" as InAppMessage["messageType"],
    title: "",
    body: "",
    ctaText: "",
    ctaUrl: "",
    targetUrlPattern: "*",
    maxImpressions: 0,
  });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch { setMessages([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setCreateForm({ name: "", messageType: "banner", title: "", body: "", ctaText: "", ctaUrl: "", targetUrlPattern: "*", maxImpressions: 0 });
        setShowCreate(false);
        load();
      }
    } catch { /* ignore */ }
    finally { setCreating(false); }
  }

  async function handleToggle(id: string) {
    try {
      await fetch(`/api/messages/${id}`, { method: "PATCH" });
      load();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/messages/${id}`, { method: "DELETE" });
      load();
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading messages...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Proactive Messaging
            </p>
            <h1 className="mt-2 text-3xl font-bold">In-App Messages</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Display targeted banners, modals, tooltips, and slide-ins to customers.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showCreate ? "Cancel" : "New Message"}
          </button>
        </div>
      </header>

      {showCreate && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Message</h3>
          <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Name</span>
              <input
                type="text"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Type</span>
              <select
                value={createForm.messageType}
                onChange={(e) => setCreateForm({ ...createForm, messageType: e.target.value as InAppMessage["messageType"] })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                <option value="banner">Banner</option>
                <option value="modal">Modal</option>
                <option value="tooltip">Tooltip</option>
                <option value="slide_in">Slide-in</option>
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Title</span>
              <input
                type="text"
                required
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">URL Pattern</span>
              <input
                type="text"
                value={createForm.targetUrlPattern}
                onChange={(e) => setCreateForm({ ...createForm, targetUrlPattern: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="font-mono text-xs font-bold uppercase">Body</span>
              <textarea
                value={createForm.body}
                onChange={(e) => setCreateForm({ ...createForm, body: e.target.value })}
                rows={3}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">CTA Text</span>
              <input
                type="text"
                value={createForm.ctaText}
                onChange={(e) => setCreateForm({ ...createForm, ctaText: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">CTA URL</span>
              <input
                type="text"
                value={createForm.ctaUrl}
                onChange={(e) => setCreateForm({ ...createForm, ctaUrl: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Message"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">{messages.length} Message{messages.length !== 1 ? "s" : ""}</h2>
      </div>

      {messages.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Type</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Title</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">URL</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${m.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{m.name}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase">{TYPE_LABELS[m.messageType]}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-zinc-500">{m.title}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{m.targetUrlPattern}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggle(m.id)}
                          className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                        >
                          {m.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No messages yet</p>
          <p className="mt-2 text-sm text-zinc-600">Create your first in-app message to engage customers.</p>
        </section>
      )}
    </main>
  );
}
