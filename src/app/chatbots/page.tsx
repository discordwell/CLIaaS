"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ChatbotFlow {
  id: string;
  name: string;
  nodes: Record<string, unknown>;
  rootNodeId: string;
  enabled: boolean;
  version?: number;
  status?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplateInfo {
  key: string;
  name: string;
  description: string;
  icon: string;
}

const TEMPLATES: TemplateInfo[] = [
  { key: "support_triage", name: "Support Triage", description: "Greet, collect info, check KB, and route to the right team.", icon: "S" },
  { key: "faq_bot", name: "FAQ Bot", description: "Category-based FAQ with article suggestions and feedback loop.", icon: "F" },
  { key: "sales_router", name: "Sales Router", description: "Qualify leads, collect company info, and route to sales.", icon: "R" },
  { key: "lead_qualifier", name: "Lead Qualifier", description: "Collect lead info, AI-qualify, and hand off with context.", icon: "L" },
];

export default function ChatbotsPage() {
  const router = useRouter();
  const [chatbots, setChatbots] = useState<ChatbotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadChatbots = useCallback(async () => {
    try {
      const res = await fetch("/api/chatbots");
      const data = await res.json();
      setChatbots(data.chatbots || []);
    } catch {
      setChatbots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChatbots();
  }, [loadChatbots]);

  async function handleToggle(flow: ChatbotFlow) {
    await fetch(`/api/chatbots/${flow.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !flow.enabled }),
    });
    loadChatbots();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/chatbots/${id}`, { method: "DELETE" });
    loadChatbots();
  }

  if (showNewForm) {
    return (
      <NewFlowForm
        onCreated={(flow) => {
          setShowNewForm(false);
          router.push(`/chatbots/builder/${flow.id}`);
        }}
        onCancel={() => setShowNewForm(false)}
      />
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Chatbot Builder
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {chatbots.length} flow{chatbots.length !== 1 ? "s" : ""}
            </h1>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Flow
          </button>
        </div>
      </header>

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </section>
      ) : chatbots.length > 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="divide-y divide-zinc-200">
            {chatbots.map((flow) => (
              <div key={flow.id} className="flex items-center justify-between p-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        flow.enabled ? "bg-emerald-500" : "bg-zinc-300"
                      }`}
                    />
                    <p className="truncate text-sm font-bold">{flow.name}</p>
                    {flow.status && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          flow.status === "published"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {flow.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {Object.keys(flow.nodes).length} nodes
                    {flow.version ? ` · v${flow.version}` : ""}
                    {" · "}Created {new Date(flow.createdAt).toLocaleDateString()}
                  </p>
                  {flow.description && (
                    <p className="mt-0.5 text-xs text-zinc-400 truncate">{flow.description}</p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleToggle(flow)}
                    className={`px-3 py-1 font-mono text-xs font-bold uppercase ${
                      flow.enabled
                        ? "bg-emerald-500 text-white"
                        : "border-2 border-zinc-300 text-zinc-500"
                    }`}
                  >
                    {flow.enabled ? "Active" : "Inactive"}
                  </button>
                  <button
                    onClick={() => router.push(`/chatbots/builder/${flow.id}`)}
                    className="border-2 border-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-950 hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(flow.id)}
                    className="px-3 py-1 font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No chatbot flows</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create a flow to automate customer conversations.
          </p>
        </section>
      )}
    </main>
  );
}

function NewFlowForm({
  onCreated,
  onCancel,
}: {
  onCreated: (flow: ChatbotFlow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        template: selectedTemplate || undefined,
      };

      // If no template, create a simple starter
      if (!selectedTemplate) {
        const rootId = crypto.randomUUID();
        const btnId = crypto.randomUUID();
        const handoffId = crypto.randomUUID();
        body.nodes = {
          [rootId]: {
            id: rootId,
            type: "message",
            data: { text: "Hi! How can I help you today?" },
            children: [btnId],
            position: { x: 300, y: 0 },
          },
          [btnId]: {
            id: btnId,
            type: "buttons",
            data: {
              text: "What can I help you with?",
              options: [
                { label: "Sales", nextNodeId: handoffId },
                { label: "Support", nextNodeId: handoffId },
              ],
            },
            position: { x: 300, y: 120 },
          },
          [handoffId]: {
            id: handoffId,
            type: "handoff",
            data: { message: "Connecting you to an agent now..." },
            position: { x: 300, y: 280 },
          },
        };
        body.rootNodeId = rootId;
      }

      const res = await fetch("/api/chatbots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create");
        return;
      }

      onCreated(data.chatbot);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          New Chatbot Flow
        </p>
        <h1 className="mt-2 text-2xl font-bold">Create a Chatbot</h1>
      </header>

      <form onSubmit={handleCreate} className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <div>
          <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
            Flow Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales & Support Router"
            className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            autoFocus
          />
        </div>

        <div className="mt-6">
          <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
            Start From Template
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setSelectedTemplate(selectedTemplate === tpl.key ? null : tpl.key)}
                className={`border-2 p-4 text-left transition-colors ${
                  selectedTemplate === tpl.key
                    ? "border-zinc-950 bg-zinc-50"
                    : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center bg-zinc-950 text-xs font-bold text-white">
                    {tpl.icon}
                  </span>
                  <span className="text-sm font-bold">{tpl.name}</span>
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">{tpl.description}</p>
              </button>
            ))}
          </div>
          {!selectedTemplate && (
            <p className="mt-2 text-xs text-zinc-400">
              Or start with a blank flow — no template selected.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-4 font-mono text-xs font-bold text-red-600">{error}</p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create & Edit"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
