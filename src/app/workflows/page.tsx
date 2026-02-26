"use client";

import { useEffect, useState, useCallback } from "react";
import type { Workflow } from "./_components/types";
import { WorkflowBuilder } from "./_components/WorkflowBuilder";
import { workflowTemplates } from "@/lib/workflow/templates";

// ---- Main page component ----

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setWorkflows(data.workflows || []);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  async function handleToggle(wf: Workflow) {
    await fetch(`/api/workflows/${wf.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !wf.enabled }),
    });
    loadWorkflows();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    loadWorkflows();
  }

  async function handleExport(id: string) {
    const res = await fetch(`/api/workflows/${id}/export`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${data.workflow?.name || id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Builder view ----

  if (editingWorkflow) {
    return (
      <WorkflowBuilder
        workflow={editingWorkflow}
        onSave={async (updated) => {
          await fetch(`/api/workflows/${updated.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
          });
          setEditingWorkflow(null);
          loadWorkflows();
        }}
        onCancel={() => setEditingWorkflow(null)}
        onExport={() => handleExport(editingWorkflow.id)}
      />
    );
  }

  // ---- New workflow form ----

  if (showNewForm) {
    return (
      <NewWorkflowForm
        onCreated={(wf) => {
          setShowNewForm(false);
          setEditingWorkflow(wf);
          loadWorkflows();
        }}
        onCancel={() => setShowNewForm(false)}
      />
    );
  }

  // ---- List view ----

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Workflow Builder
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
            </h1>
          </div>
          <button
            onClick={() => setShowNewForm(true)}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            New Workflow
          </button>
        </div>
      </header>

      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </section>
      ) : workflows.length > 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="divide-y divide-zinc-200">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="flex items-center justify-between p-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        wf.enabled ? "bg-emerald-500" : "bg-zinc-300"
                      }`}
                    />
                    <p className="truncate text-sm font-bold">{wf.name}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {Object.keys(wf.nodes).length} nodes ·{" "}
                    {wf.transitions.length} transitions · v{wf.version} ·
                    Created {new Date(wf.createdAt).toLocaleDateString()}
                  </p>
                  {wf.description && (
                    <p className="mt-1 text-xs text-zinc-600">
                      {wf.description}
                    </p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleToggle(wf)}
                    className={`px-3 py-1 font-mono text-xs font-bold uppercase ${
                      wf.enabled
                        ? "bg-emerald-500 text-white"
                        : "border-2 border-zinc-300 text-zinc-500"
                    }`}
                  >
                    {wf.enabled ? "Active" : "Inactive"}
                  </button>
                  <button
                    onClick={() => setEditingWorkflow(wf)}
                    className="border-2 border-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-950 hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleExport(wf.id)}
                    className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => handleDelete(wf.id)}
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
          <p className="text-lg font-bold">No workflows</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create a workflow to automate ticket routing and lifecycle
            management.
          </p>
        </section>
      )}
    </main>
  );
}

// ---- New Workflow Form ----

function NewWorkflowForm({
  onCreated,
  onCancel,
}: {
  onCreated: (wf: Workflow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let body: Record<string, unknown>;

      if (template === "blank") {
        const triggerId = crypto.randomUUID();
        body = {
          name: name.trim(),
          nodes: {
            [triggerId]: {
              id: triggerId,
              type: "trigger",
              data: { event: "create" },
              position: { x: 300, y: 80 },
            },
          },
          transitions: [],
          entryNodeId: triggerId,
        };
      } else {
        body = { name: name.trim(), templateKey: template };
      }

      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.workflow) {
        onCreated(data.workflow);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-zinc-950">
      <div className="border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          New Workflow
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support Lifecycle"
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Template
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {/* Blank canvas card */}
              <button
                type="button"
                onClick={() => setTemplate("blank")}
                className={`border-2 p-3 text-left transition-colors ${
                  template === "blank"
                    ? "border-zinc-950 bg-zinc-50"
                    : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <p className="font-mono text-xs font-bold">Blank Canvas</p>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Start from scratch with just a trigger node
                </p>
                <div className="mt-2 flex gap-2 font-mono text-[10px] text-zinc-400">
                  <span>1 node</span>
                  <span>0 transitions</span>
                </div>
              </button>

              {/* Template cards */}
              {workflowTemplates.map((tmpl) => (
                <button
                  key={tmpl.key}
                  type="button"
                  onClick={() => setTemplate(tmpl.key)}
                  className={`border-2 p-3 text-left transition-colors ${
                    template === tmpl.key
                      ? "border-zinc-950 bg-zinc-50"
                      : "border-zinc-200 hover:border-zinc-400"
                  }`}
                >
                  <p className="font-mono text-xs font-bold">{tmpl.label}</p>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {tmpl.description}
                  </p>
                  <div className="mt-2 flex gap-2 font-mono text-[10px] text-zinc-400">
                    <span>{tmpl.meta.nodeCount} nodes</span>
                    <span>{tmpl.meta.transitionCount} transitions</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tmpl.meta.keyStates.map((s) => (
                      <span
                        key={s}
                        className="bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onCancel}
              className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
