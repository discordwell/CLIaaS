"use client";

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import { useEffect, useState, useCallback } from "react";

interface Rule {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  conditions: { all?: Array<{ field: string; operator: string; value: unknown }>; any?: Array<{ field: string; operator: string; value: unknown }> };
  actions: Array<{ type: string; value?: unknown }>;
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
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "trigger" as string,
    conditionField: "status",
    conditionOp: "is",
    conditionValue: "",
    actionType: "set_priority",
    actionValue: "",
  });
  const [saving, setSaving] = useState(false);

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

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          type: formData.type,
          conditions: {
            all: formData.conditionValue
              ? [{ field: formData.conditionField, operator: formData.conditionOp, value: formData.conditionValue }]
              : [],
          },
          actions: [{ type: formData.actionType, value: formData.actionValue || undefined }],
        }),
      });
      setShowForm(false);
      setFormData({ name: "", type: "trigger", conditionField: "status", conditionOp: "is", conditionValue: "", actionType: "set_priority", actionValue: "" });
      loadRules();
    } finally {
      setSaving(false);
    }
  }

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
            <button
              onClick={() => setShowForm(!showForm)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {showForm ? "Cancel" : "New Rule"}
            </button>
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

      {showForm && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Rule</h2>
          <form onSubmit={createRule} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Name</span>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Auto-escalate urgent"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Type</span>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                <option value="trigger">Trigger</option>
                <option value="macro">Macro</option>
                <option value="automation">Automation</option>
                <option value="sla">SLA</option>
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Condition field</span>
              <select
                value={formData.conditionField}
                onChange={(e) => setFormData({ ...formData, conditionField: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {["status", "priority", "subject", "tags", "assignee", "requester", "source", "hours_since_created", "hours_since_updated"].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Operator</span>
              <select
                value={formData.conditionOp}
                onChange={(e) => setFormData({ ...formData, conditionOp: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {["is", "is_not", "contains", "not_contains", "starts_with", "greater_than", "less_than", "is_empty", "is_not_empty"].map((o) => (
                  <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Condition value</span>
              <input
                type="text"
                value={formData.conditionValue}
                onChange={(e) => setFormData({ ...formData, conditionValue: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="urgent"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Action type</span>
              <select
                value={formData.actionType}
                onChange={(e) => setFormData({ ...formData, actionType: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {["set_priority", "set_status", "assign_to", "add_tag", "remove_tag", "close", "reopen", "escalate", "add_internal_note", "send_notification"].map((a) => (
                  <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Action value</span>
              <input
                type="text"
                value={formData.actionValue}
                onChange={(e) => setFormData({ ...formData, actionValue: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="high"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Rule"}
              </button>
            </div>
          </form>
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
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Conditions</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Actions</th>
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
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {[...(r.conditions?.all || []), ...(r.conditions?.any || [])].length} condition{[...(r.conditions?.all || []), ...(r.conditions?.any || [])].length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {r.actions?.length || 0} action{(r.actions?.length || 0) !== 1 ? "s" : ""}
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
                      <button
                        onClick={() => deleteRule(r.id)}
                        className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No rules found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create automation rules to streamline your workflow.
          </p>
        </section>
      )}
    </main>
  );
}
