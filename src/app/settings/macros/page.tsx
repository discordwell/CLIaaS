"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MacroAction {
  type: string;
  value?: string;
  field?: string;
}

interface Macro {
  id: string;
  name: string;
  description?: string;
  actions: MacroAction[];
  scope: string;
  enabled: boolean;
  usageCount: number;
}

const ACTION_TYPES = [
  { value: "set_status", label: "Set Status", options: ["open", "pending", "on_hold", "solved", "closed"] },
  { value: "set_priority", label: "Set Priority", options: ["low", "normal", "high", "urgent"] },
  { value: "add_tag", label: "Add Tag" },
  { value: "remove_tag", label: "Remove Tag" },
  { value: "assign", label: "Assign Agent" },
  { value: "add_reply", label: "Add Reply" },
  { value: "add_note", label: "Add Internal Note" },
];

export default function MacrosPage() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"shared" | "personal">("shared");
  const [actions, setActions] = useState<MacroAction[]>([{ type: "set_status", value: "solved" }]);
  const [saving, setSaving] = useState(false);

  const fetchMacros = () => {
    fetch("/api/macros")
      .then((r) => r.json())
      .then((d) => setMacros(d.macros ?? []))
      .catch(() => setMacros([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMacros(); }, []);

  const resetForm = () => {
    setName(""); setDescription(""); setScope("shared");
    setActions([{ type: "set_status", value: "solved" }]);
    setEditId(null); setShowForm(false);
  };

  const handleSave = async () => {
    if (!name.trim() || actions.length === 0) return;
    setSaving(true);
    try {
      const url = editId ? `/api/macros/${editId}` : "/api/macros";
      const method = editId ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined, scope, actions }),
      });
      resetForm();
      fetchMacros();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (m: Macro) => {
    setEditId(m.id);
    setName(m.name);
    setDescription(m.description ?? "");
    setScope(m.scope as "shared" | "personal");
    setActions(m.actions);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/macros/${id}`, { method: "DELETE" });
    fetchMacros();
  };

  const addAction = () => setActions([...actions, { type: "set_status", value: "solved" }]);
  const removeAction = (idx: number) => setActions(actions.filter((_, i) => i !== idx));
  const updateAction = (idx: number, updates: Partial<MacroAction>) => {
    setActions(actions.map((a, i) => i === idx ? { ...a, ...updates } : a));
  };

  const summarizeActions = (acts: MacroAction[]) =>
    acts.map(a => `${a.type.replace(/_/g, " ")}: ${a.value ?? a.field ?? ""}`).join(" → ");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span>/</span>
        <Link href="/settings" className="hover:underline">Settings</Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Macros</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Automation</p>
            <h1 className="mt-2 text-3xl font-bold">Macros</h1>
            <p className="mt-2 text-sm text-zinc-600">
              One-click multi-action bundles. Apply to tickets from the detail page or via CLI/MCP.
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            + New Macro
          </button>
        </div>
      </header>

      {/* CREATE/EDIT FORM */}
      {showForm && (
        <section className="mt-6 border-2 border-zinc-950 bg-white p-6">
          <h3 className="text-lg font-bold">{editId ? "Edit" : "New"} Macro</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none" />
            </div>
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none" />
            </div>
          </div>

          {/* ACTION BUILDER */}
          <div className="mt-6">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">Actions</label>
            <div className="mt-2 space-y-2">
              {actions.map((action, idx) => {
                const typeDef = ACTION_TYPES.find(t => t.value === action.type);
                return (
                  <div key={idx} className="flex items-center gap-2 border border-zinc-200 bg-zinc-50 p-2">
                    <span className="font-mono text-[10px] font-bold text-zinc-400">{idx + 1}.</span>
                    <select value={action.type} onChange={(e) => updateAction(idx, { type: e.target.value, value: "" })}
                      className="border border-zinc-300 px-2 py-1 font-mono text-xs focus:outline-none">
                      {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {typeDef?.options ? (
                      <select value={action.value ?? ""} onChange={(e) => updateAction(idx, { value: e.target.value })}
                        className="flex-1 border border-zinc-300 px-2 py-1 font-mono text-xs focus:outline-none">
                        <option value="">Select...</option>
                        {typeDef.options.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={action.value ?? ""} onChange={(e) => updateAction(idx, { value: e.target.value })}
                        placeholder={action.type === "add_reply" || action.type === "add_note" ? "Template text..." : "Value"}
                        className="flex-1 border border-zinc-300 px-2 py-1 font-mono text-xs focus:outline-none" />
                    )}
                    <button onClick={() => removeAction(idx)} className="font-mono text-xs text-red-500 hover:text-red-700">✕</button>
                  </div>
                );
              })}
            </div>
            <button onClick={addAction}
              className="mt-2 border border-dashed border-zinc-400 px-3 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-700">
              + Add Action
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
              {saving ? "Saving..." : editId ? "Update" : "Create"}
            </button>
            <button onClick={resetForm}
              className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950">
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* TABLE */}
      <section className="mt-6 border-2 border-zinc-950 bg-white">
        {loading ? (
          <p className="p-8 text-center text-sm text-zinc-500">Loading...</p>
        ) : macros.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No macros yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-zinc-950 bg-zinc-50">
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Actions</th>
                <th className="p-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">Scope</th>
                <th className="p-3 text-right font-mono text-xs font-bold uppercase text-zinc-500">Uses</th>
                <th className="p-3 text-right font-mono text-xs font-bold uppercase text-zinc-500">Manage</th>
              </tr>
            </thead>
            <tbody>
              {macros.map((m) => (
                <tr key={m.id} className="border-b border-zinc-200 hover:bg-zinc-50">
                  <td className="p-3">
                    <span className="text-sm font-bold">{m.name}</span>
                    {m.description && <p className="mt-0.5 text-xs text-zinc-500">{m.description}</p>}
                  </td>
                  <td className="p-3 font-mono text-[11px] text-zinc-600">{summarizeActions(m.actions)}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 font-mono text-[10px] font-bold ${m.scope === "shared" ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
                      {m.scope.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-xs text-zinc-600">{m.usageCount}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleEdit(m)} className="font-mono text-xs text-blue-600 hover:underline">Edit</button>
                    <button onClick={() => handleDelete(m.id)} className="ml-3 font-mono text-xs text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
