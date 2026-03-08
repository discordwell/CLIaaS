"use client";

import { useEffect, useState, useCallback } from "react";
import RuleForm, { type RuleFormData } from "./_components/RuleForm";
import EmptyState from "@/components/EmptyState";

interface Rule {
  id: string;
  type: string;
  name: string;
  description?: string;
  enabled: boolean;
  conditions: {
    all?: Array<{ field: string; operator: string; value: unknown }>;
    any?: Array<{ field: string; operator: string; value: unknown }>;
  };
  actions: Array<{ type: string; value?: unknown; [k: string]: unknown }>;
  executionCount?: number;
  lastExecutedAt?: string;
  executionOrder?: number;
}

const typeColors: Record<string, string> = {
  trigger: "bg-blue-500 text-white",
  macro: "bg-emerald-500 text-white",
  automation: "bg-amber-400 text-black",
  sla: "bg-red-500 text-white",
};

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const url = filter ? `/api/rules?type=${filter}` : "/api/rules";
      const res = await fetch(url);
      const data = await res.json();
      setRules(data.rules || []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  async function toggleRule(id: string, enabled: boolean) {
    await fetch(`/api/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    loadRules();
  }

  async function deleteRule(id: string) {
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    loadRules();
  }

  async function handleCreate(data: RuleFormData) {
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        type: data.type,
        description: data.description || undefined,
        conditions: data.conditions,
        actions: data.actions,
        enabled: data.enabled,
      }),
    });
    setMode("list");
    loadRules();
  }

  async function handleEdit(data: RuleFormData) {
    if (!editingRule) return;
    await fetch(`/api/rules/${editingRule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        description: data.description || undefined,
        conditions: data.conditions,
        actions: data.actions,
        enabled: data.enabled,
      }),
    });
    setMode("list");
    setEditingRule(null);
    loadRules();
  }

  function startEdit(rule: Rule) {
    setEditingRule(rule);
    setMode("edit");
  }

  const conditionCount = (r: Rule) =>
    (r.conditions?.all?.length ?? 0) + (r.conditions?.any?.length ?? 0);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Automation
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </h1>
          </div>
          <div className="flex gap-3">
            {mode === "list" ? (
              <button
                onClick={() => setMode("create")}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                New Rule
              </button>
            ) : (
              <button
                onClick={() => { setMode("list"); setEditingRule(null); }}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {["", "trigger", "macro", "automation", "sla"].map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                filter === t
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {t || "all"}
            </button>
          ))}
        </div>
      </header>

      {mode === "create" && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h2 className="mb-4 font-mono text-xs font-bold uppercase text-zinc-500">
            Create Rule
          </h2>
          <RuleForm
            onSubmit={handleCreate}
            onCancel={() => setMode("list")}
            submitLabel="Create Rule"
          />
        </section>
      )}

      {mode === "edit" && editingRule && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h2 className="mb-4 font-mono text-xs font-bold uppercase text-zinc-500">
            Edit Rule
          </h2>
          <RuleForm
            initial={{
              name: editingRule.name,
              type: editingRule.type,
              description: editingRule.description ?? "",
              conditions: {
                all: editingRule.conditions?.all ?? [],
                any: editingRule.conditions?.any ?? [],
              },
              actions: editingRule.actions ?? [],
              enabled: editingRule.enabled,
            }}
            ruleId={editingRule.id}
            onSubmit={handleEdit}
            onCancel={() => { setMode("list"); setEditingRule(null); }}
            submitLabel="Update Rule"
          />
        </section>
      )}

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading rules...</p>
        </section>
      ) : rules.length > 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Type</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Description</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Conditions</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Actions</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Runs</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${typeColors[r.type] ?? "bg-zinc-200"}`}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-zinc-500">
                      {r.description || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {conditionCount(r)} condition{conditionCount(r) !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {r.actions?.length || 0} action{(r.actions?.length || 0) !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {r.executionCount ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRule(r.id, r.enabled)}
                        className={`font-mono text-xs font-bold uppercase ${r.enabled ? "text-emerald-600" : "text-zinc-400"}`}
                      >
                        {r.enabled ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => startEdit(r)}
                          className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRule(r.id)}
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
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <EmptyState
            title="No automation rules yet"
            description="Rules let you auto-assign tickets, apply tags, send notifications, and escalate issues based on conditions you define. Start with a simple trigger to see how it works."
            action={{ label: "Create your first rule", href: "/rules" }}
          />
        </section>
      )}
    </main>
  );
}
