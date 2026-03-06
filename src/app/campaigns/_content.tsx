"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---- Types ----

interface Campaign {
  id: string;
  name: string;
  channel: "email" | "sms" | "whatsapp" | "in_app" | "push";
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "active" | "paused" | "completed";
  subject?: string;
  templateBody?: string;
  entryStepId?: string;
  scheduledAt?: string;
  sentAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface CampaignAnalytics {
  campaignId: string;
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

// ---- Helpers ----

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusColor(status: Campaign["status"]): string {
  switch (status) {
    case "draft":
      return "bg-zinc-200 text-zinc-600";
    case "scheduled":
      return "bg-blue-100 text-blue-700";
    case "sending":
      return "bg-amber-100 text-amber-700";
    case "sent":
      return "bg-emerald-100 text-emerald-700";
    case "cancelled":
      return "bg-red-100 text-red-700";
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "paused":
      return "bg-amber-100 text-amber-700";
    case "completed":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-zinc-200 text-zinc-600";
  }
}

// ======================== MAIN COMPONENT ========================

export default function CampaignsPageContent() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    channel: "email" as Campaign["channel"],
    subject: "",
    templateBody: "",
  });
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setCreateForm({ name: "", channel: "email", subject: "", templateBody: "" });
        setShowCreate(false);
        load();
      }
    } catch {
      // Silently fail
    } finally {
      setCreating(false);
    }
  }

  async function handleSend(id: string) {
    setSendingId(id);
    try {
      await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
      load();
    } catch {
      // Silently fail
    } finally {
      setSendingId(null);
    }
  }

  async function loadAnalytics(id: string) {
    if (selectedId === id) {
      setSelectedId(null);
      setAnalytics(null);
      return;
    }
    setSelectedId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}/analytics`);
      const data = await res.json();
      setAnalytics(data.analytics ?? null);
    } catch {
      setAnalytics(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading campaigns...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Proactive Messaging
            </p>
            <h1 className="mt-2 text-3xl font-bold">Campaigns</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Create and send outbound campaigns via email, SMS, or WhatsApp.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showCreate ? "Cancel" : "New Campaign"}
          </button>
        </div>
      </header>

      {/* CREATE FORM */}
      {showCreate && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Create Campaign
          </h3>
          <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Name</span>
              <input
                type="text"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="e.g. Welcome Series"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Channel</span>
              <select
                value={createForm.channel}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    channel: e.target.value as Campaign["channel"],
                  })
                }
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="in_app">In-App</option>
                <option value="push">Push</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="font-mono text-xs font-bold uppercase">Subject</span>
              <input
                type="text"
                value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Email subject line"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="font-mono text-xs font-bold uppercase">Body Template</span>
              <textarea
                value={createForm.templateBody}
                onChange={(e) => setCreateForm({ ...createForm, templateBody: e.target.value })}
                rows={4}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Hi {{name}}, ..."
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Campaign"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ANALYTICS DETAIL */}
      {selectedId && analytics && (
        <section className="mt-4 border-2 border-zinc-950 bg-white">
          <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
              Campaign Analytics
            </h3>
            <button
              onClick={() => {
                setSelectedId(null);
                setAnalytics(null);
              }}
              className="border-2 border-zinc-300 bg-white px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: "Total", value: analytics.total },
              { label: "Pending", value: analytics.pending },
              { label: "Sent", value: analytics.sent },
              { label: "Delivered", value: analytics.delivered },
              { label: "Opened", value: analytics.opened },
              { label: "Clicked", value: analytics.clicked },
              { label: "Failed", value: analytics.failed },
            ].map((s) => (
              <div key={s.label} className="border border-zinc-200 p-3">
                <p className="font-mono text-xs text-zinc-500">{s.label}</p>
                <p className="mt-1 text-xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CAMPAIGN LIST */}
      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {campaigns.length} Campaign{campaigns.length !== 1 ? "s" : ""}
        </h2>
      </div>

      {campaigns.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Name
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Channel
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Subject
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Updated
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${
                      selectedId === c.id ? "bg-zinc-100" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor(c.status)}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase">{c.channel}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-zinc-500">
                      {c.subject || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {shortDate(c.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => loadAnalytics(c.id)}
                          className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                        >
                          {selectedId === c.id ? "Hide" : "Analytics"}
                        </button>
                        {(c.status === "draft" || c.status === "scheduled") && (
                          <button
                            onClick={() => handleSend(c.id)}
                            disabled={sendingId === c.id}
                            className="font-mono text-xs font-bold uppercase text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                          >
                            {sendingId === c.id ? "Sending..." : "Send"}
                          </button>
                        )}
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
          <p className="text-lg font-bold">No campaigns yet</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create your first outbound campaign to start engaging customers proactively.
          </p>
        </section>
      )}
    </main>
  );
}
