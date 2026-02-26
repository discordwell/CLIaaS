"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

// ---- Types (mirror server types) ----

type WorkflowNodeType =
  | "trigger"
  | "state"
  | "condition"
  | "action"
  | "delay"
  | "end";

interface WorkflowCondition {
  field: string;
  operator: string;
  value: unknown;
}

interface WorkflowAction {
  type: string;
  value?: unknown;
  field?: string;
  to?: string;
}

interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

interface WorkflowTransition {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  conditions?: WorkflowCondition[];
  actions?: WorkflowAction[];
  branchKey?: string;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: Record<string, WorkflowNode>;
  transitions: WorkflowTransition[];
  entryNodeId: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Node type config ----

const nodeTypeConfig: Record<
  WorkflowNodeType,
  { label: string; color: string; icon: string; shape: string }
> = {
  trigger: {
    label: "Trigger",
    color: "bg-amber-500",
    icon: "\u26A1",
    shape: "pill",
  },
  state: {
    label: "State",
    color: "bg-blue-500",
    icon: "\u25CB",
    shape: "rect",
  },
  condition: {
    label: "Condition",
    color: "bg-amber-400",
    icon: "?",
    shape: "diamond",
  },
  action: {
    label: "Action",
    color: "bg-emerald-500",
    icon: "\u2699",
    shape: "rect",
  },
  delay: {
    label: "Delay",
    color: "bg-purple-500",
    icon: "\u23F1",
    shape: "rect",
  },
  end: { label: "End", color: "bg-red-500", icon: "\u2716", shape: "circle" },
};

// ---- Fields, operators, action types (reuse from rules page) ----

const FIELDS = [
  "status",
  "priority",
  "assignee",
  "requester",
  "subject",
  "tags",
  "source",
  "event",
  "hours_since_created",
  "hours_since_updated",
  "message_body",
];

const OPERATORS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
  "changed",
  "changed_to",
  "in",
  "matches",
];

const ACTION_TYPES = [
  "set_status",
  "set_priority",
  "set_assignee",
  "assign_to",
  "unassign",
  "add_tag",
  "remove_tag",
  "set_field",
  "add_internal_note",
  "send_notification",
  "webhook",
  "close",
  "reopen",
  "escalate",
];

const EVENTS = ["create", "update", "reply", "status_change", "assignment"];

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
        const templateWorkflows: Record<
          string,
          () => { nodes: Record<string, WorkflowNode>; transitions: WorkflowTransition[]; entryNodeId: string }
        > = {
          "simple-lifecycle": () => {
            const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
            const nodes: Record<string, WorkflowNode> = {
              [ids[0]]: { id: ids[0], type: "trigger", data: { event: "create" }, position: { x: 300, y: 40 } },
              [ids[1]]: { id: ids[1], type: "state", data: { label: "New", color: "bg-blue-500" }, position: { x: 300, y: 140 } },
              [ids[2]]: { id: ids[2], type: "state", data: { label: "Triage", color: "bg-amber-500" }, position: { x: 300, y: 240 } },
              [ids[3]]: { id: ids[3], type: "state", data: { label: "In Progress", color: "bg-emerald-500" }, position: { x: 300, y: 340 } },
              [ids[4]]: { id: ids[4], type: "state", data: { label: "Waiting", color: "bg-purple-500" }, position: { x: 300, y: 440 } },
              [ids[5]]: { id: ids[5], type: "state", data: { label: "Resolved", color: "bg-teal-500" }, position: { x: 300, y: 540 } },
              [ids[6]]: { id: ids[6], type: "end", data: { label: "Closed" }, position: { x: 300, y: 640 } },
            };
            return {
              nodes,
              transitions: [
                { id: crypto.randomUUID(), fromNodeId: ids[0], toNodeId: ids[1] },
                { id: crypto.randomUUID(), fromNodeId: ids[1], toNodeId: ids[2], label: "Review" },
                { id: crypto.randomUUID(), fromNodeId: ids[2], toNodeId: ids[3], label: "Assign" },
                { id: crypto.randomUUID(), fromNodeId: ids[3], toNodeId: ids[4], label: "Waiting on customer" },
                { id: crypto.randomUUID(), fromNodeId: ids[4], toNodeId: ids[3], label: "Customer replied" },
                { id: crypto.randomUUID(), fromNodeId: ids[3], toNodeId: ids[5], label: "Resolve" },
                { id: crypto.randomUUID(), fromNodeId: ids[5], toNodeId: ids[6], label: "Close" },
                { id: crypto.randomUUID(), fromNodeId: ids[5], toNodeId: ids[3], label: "Reopen" },
              ],
              entryNodeId: ids[0],
            };
          },
          "escalation-pipeline": () => {
            const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
            const nodes: Record<string, WorkflowNode> = {
              [ids[0]]: { id: ids[0], type: "trigger", data: { event: "create" }, position: { x: 300, y: 40 } },
              [ids[1]]: { id: ids[1], type: "condition", data: { logic: "any", conditions: [{ field: "priority", operator: "is", value: "urgent" }] }, position: { x: 300, y: 160 } },
              [ids[2]]: { id: ids[2], type: "action", data: { actions: [{ type: "set_priority", value: "urgent" }, { type: "add_tag", value: "escalated" }] }, position: { x: 120, y: 300 } },
              [ids[3]]: { id: ids[3], type: "state", data: { label: "Queue", color: "bg-zinc-400" }, position: { x: 480, y: 300 } },
              [ids[4]]: { id: ids[4], type: "state", data: { label: "In Progress", color: "bg-emerald-500" }, position: { x: 300, y: 440 } },
              [ids[5]]: { id: ids[5], type: "end", data: { label: "Resolved" }, position: { x: 300, y: 560 } },
            };
            return {
              nodes,
              transitions: [
                { id: crypto.randomUUID(), fromNodeId: ids[0], toNodeId: ids[1] },
                { id: crypto.randomUUID(), fromNodeId: ids[1], toNodeId: ids[2], label: "Urgent", branchKey: "yes" },
                { id: crypto.randomUUID(), fromNodeId: ids[1], toNodeId: ids[3], label: "Normal", branchKey: "no" },
                { id: crypto.randomUUID(), fromNodeId: ids[2], toNodeId: ids[4] },
                { id: crypto.randomUUID(), fromNodeId: ids[3], toNodeId: ids[4], label: "Pick up" },
                { id: crypto.randomUUID(), fromNodeId: ids[4], toNodeId: ids[5], label: "Resolve" },
              ],
              entryNodeId: ids[0],
            };
          },
          "sla-driven": () => {
            const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
            const nodes: Record<string, WorkflowNode> = {
              [ids[0]]: { id: ids[0], type: "trigger", data: { event: "create" }, position: { x: 300, y: 40 } },
              [ids[1]]: { id: ids[1], type: "state", data: { label: "New", color: "bg-blue-500", slaMinutes: 60 }, position: { x: 300, y: 160 } },
              [ids[2]]: { id: ids[2], type: "state", data: { label: "In Progress", color: "bg-emerald-500", slaMinutes: 240 }, position: { x: 300, y: 300 } },
              [ids[3]]: { id: ids[3], type: "state", data: { label: "Escalated", color: "bg-red-500" }, position: { x: 300, y: 440 } },
              [ids[4]]: { id: ids[4], type: "end", data: { label: "Resolved" }, position: { x: 300, y: 560 } },
            };
            return {
              nodes,
              transitions: [
                { id: crypto.randomUUID(), fromNodeId: ids[0], toNodeId: ids[1] },
                { id: crypto.randomUUID(), fromNodeId: ids[1], toNodeId: ids[2], label: "Assign" },
                { id: crypto.randomUUID(), fromNodeId: ids[2], toNodeId: ids[3], label: "Escalate" },
                { id: crypto.randomUUID(), fromNodeId: ids[2], toNodeId: ids[4], label: "Resolve" },
                { id: crypto.randomUUID(), fromNodeId: ids[3], toNodeId: ids[4], label: "Resolve" },
              ],
              entryNodeId: ids[0],
            };
          },
        };

        const tmpl = templateWorkflows[template];
        if (!tmpl) {
          setSaving(false);
          return;
        }
        const tmplData = tmpl();
        body = { name: name.trim(), ...tmplData };
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
    <main className="mx-auto max-w-lg px-6 py-12 text-zinc-950">
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
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
            >
              <option value="blank">Blank canvas</option>
              <option value="simple-lifecycle">Simple Lifecycle</option>
              <option value="escalation-pipeline">Escalation Pipeline</option>
              <option value="sla-driven">SLA-Driven</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create"}
            </button>
            <button
              onClick={onCancel}
              className="border-2 border-zinc-300 px-6 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---- Workflow Builder (visual canvas) ----

const NODE_W = 160;
const NODE_H = 56;
const PORT_R = 6;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

function WorkflowBuilder({
  workflow,
  onSave,
  onCancel,
  onExport,
}: {
  workflow: Workflow;
  onSave: (updated: Workflow) => void;
  onCancel: () => void;
  onExport: () => void;
}) {
  const [nodes, setNodes] = useState<Record<string, WorkflowNode>>(
    workflow.nodes,
  );
  const [transitions, setTransitions] = useState<WorkflowTransition[]>(
    workflow.transitions,
  );
  const [entryNodeId, setEntryNodeId] = useState(workflow.entryNodeId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<
    string | null
  >(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [connecting, setConnecting] = useState<{
    fromNodeId: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Undo stack
  const undoStackRef = useRef<
    Array<{
      nodes: Record<string, WorkflowNode>;
      transitions: WorkflowTransition[];
    }>
  >([]);
  const [, forceUndoRender] = useState(0);

  // Use refs for undo so keyboard handler always has current state
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const transitionsRef = useRef(transitions);
  transitionsRef.current = transitions;

  function pushUndo() {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      {
        nodes: JSON.parse(JSON.stringify(nodesRef.current)),
        transitions: JSON.parse(JSON.stringify(transitionsRef.current)),
      },
    ];
  }

  function undo() {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setNodes(last.nodes);
    setTransitions(last.transitions);
    forceUndoRender((n) => n + 1);
  }

  // Keyboard shortcuts — use refs to avoid stale closures
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const selectedTransitionIdRef = useRef(selectedTransitionId);
  selectedTransitionIdRef.current = selectedTransitionId;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "SELECT" ||
          document.activeElement?.tagName === "TEXTAREA"
        )
          return;
        const nodeId = selectedNodeIdRef.current;
        const transId = selectedTransitionIdRef.current;
        if (nodeId) {
          pushUndo();
          setNodes((prev) => {
            const next = { ...prev };
            delete next[nodeId];
            return next;
          });
          setTransitions((prev) =>
            prev.filter(
              (t) => t.fromNodeId !== nodeId && t.toNodeId !== nodeId,
            ),
          );
          setSelectedNodeId(null);
        } else if (transId) {
          pushUndo();
          setTransitions((prev) =>
            prev.filter((t) => t.id !== transId),
          );
          setSelectedTransitionId(null);
        }
      }
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedTransitionId(null);
        setConnecting(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Add node from palette
  function addNode(type: WorkflowNodeType) {
    pushUndo();
    const id = crypto.randomUUID();
    const defaultData: Record<WorkflowNodeType, Record<string, unknown>> = {
      trigger: { event: "create" },
      state: { label: "New State", color: "bg-blue-500" },
      condition: {
        logic: "all",
        conditions: [{ field: "status", operator: "is", value: "open" }],
      },
      action: { actions: [{ type: "add_tag", value: "processed" }] },
      delay: { type: "time", minutes: 60 },
      end: { label: "End" },
    };
    const newNode: WorkflowNode = {
      id,
      type,
      data: defaultData[type],
      position: { x: 300 - panOffset.x / zoom, y: 200 - panOffset.y / zoom },
    };
    setNodes((prev) => ({ ...prev, [id]: newNode }));
    setSelectedNodeId(id);
    setSelectedTransitionId(null);
  }

  // Node drag
  function handleNodeMouseDown(
    e: React.MouseEvent,
    nodeId: string,
    isPort: boolean,
  ) {
    e.stopPropagation();
    if (isPort) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setConnecting({
        fromNodeId: nodeId,
        mouseX: (e.clientX - rect.left - panOffset.x) / zoom,
        mouseY: (e.clientY - rect.top - panOffset.y) / zoom,
      });
      return;
    }
    pushUndo(); // Capture pre-drag state for undo
    setDraggingNodeId(nodeId);
    setDragStart({ x: e.clientX, y: e.clientY });
    setSelectedNodeId(nodeId);
    setSelectedTransitionId(null);
  }

  // Canvas mouse handling
  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
    } else if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") {
      setSelectedNodeId(null);
      setSelectedTransitionId(null);
    }
  }

  function handleCanvasMouseMove(e: React.MouseEvent) {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (draggingNodeId) {
      const dx = (e.clientX - dragStart.x) / zoom;
      const dy = (e.clientY - dragStart.y) / zoom;
      setNodes((prev) => ({
        ...prev,
        [draggingNodeId]: {
          ...prev[draggingNodeId],
          position: {
            x: prev[draggingNodeId].position.x + dx,
            y: prev[draggingNodeId].position.y + dy,
          },
        },
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (connecting) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setConnecting({
        ...connecting,
        mouseX: (e.clientX - rect.left - panOffset.x) / zoom,
        mouseY: (e.clientY - rect.top - panOffset.y) / zoom,
      });
    }
  }

  function handleCanvasMouseUp(e: React.MouseEvent) {
    if (draggingNodeId) {
      setDraggingNodeId(null);
    }
    setIsPanning(false);

    if (connecting) {
      // Check if dropped on a node's input port
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const mx = (e.clientX - rect.left - panOffset.x) / zoom;
        const my = (e.clientY - rect.top - panOffset.y) / zoom;
        for (const node of Object.values(nodes)) {
          if (node.id === connecting.fromNodeId) continue;
          const nx = node.position.x + NODE_W / 2;
          const ny = node.position.y;
          if (Math.abs(mx - nx) < 30 && Math.abs(my - ny) < 20) {
            pushUndo();
            const newTransition: WorkflowTransition = {
              id: crypto.randomUUID(),
              fromNodeId: connecting.fromNodeId,
              toNodeId: node.id,
            };
            setTransitions((prev) => [...prev, newTransition]);
            break;
          }
        }
      }
      setConnecting(null);
    }
  }

  // Wheel zoom — register as non-passive to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Save
  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        ...workflow,
        nodes,
        transitions,
        entryNodeId,
      });
    } finally {
      setSaving(false);
    }
  }

  // Import
  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const wf = data.workflow || data;
        if (wf.nodes && wf.transitions && wf.entryNodeId) {
          pushUndo();
          setNodes(wf.nodes);
          setTransitions(wf.transitions);
          setEntryNodeId(wf.entryNodeId);
        }
      } catch {
        // Invalid JSON
      }
    };
    input.click();
  }

  // SVG transition paths
  const transitionPaths = useMemo(() => {
    return transitions.map((t) => {
      const from = nodes[t.fromNodeId];
      const to = nodes[t.toNodeId];
      if (!from || !to) return null;

      const x1 = from.position.x + NODE_W / 2;
      const y1 = from.position.y + NODE_H;
      const x2 = to.position.x + NODE_W / 2;
      const y2 = to.position.y;

      const dy = Math.abs(y2 - y1);
      const cp = Math.max(40, dy * 0.4);

      const d = `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      return { ...t, d, midX, midY, x1, y1, x2, y2 };
    });
  }, [transitions, nodes]);

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;
  const selectedTransition = selectedTransitionId
    ? transitions.find((t) => t.id === selectedTransitionId)
    : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-100 text-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 bg-white px-4 py-2">
        <div className="flex items-center gap-4">
          <button
            onClick={onCancel}
            className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
          >
            &larr; Back
          </button>
          <span className="font-mono text-xs text-zinc-400">|</span>
          <span className="font-mono text-sm font-bold">{workflow.name}</span>
          <span className="font-mono text-xs text-zinc-400">
            v{workflow.version}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
          >
            Import
          </button>
          <button
            onClick={onExport}
            className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
          >
            Export JSON
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Node palette */}
        <div className="w-48 shrink-0 border-r-2 border-zinc-950 bg-white p-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            Add Node
          </p>
          <div className="mt-3 space-y-1.5">
            {(Object.entries(nodeTypeConfig) as [WorkflowNodeType, typeof nodeTypeConfig[WorkflowNodeType]][]).map(
              ([type, cfg]) => (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs font-bold hover:bg-zinc-100"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded text-[10px] text-white ${cfg.color}`}
                  >
                    {cfg.icon}
                  </span>
                  <span className="uppercase">{cfg.label}</span>
                </button>
              ),
            )}
          </div>
          <div className="mt-6 border-t border-zinc-200 pt-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Controls
            </p>
            <p className="mt-2 text-[10px] text-zinc-500">
              Shift+Drag to pan
            </p>
            <p className="text-[10px] text-zinc-500">Scroll to zoom</p>
            <p className="text-[10px] text-zinc-500">
              Drag from bottom port to connect
            </p>
            <p className="text-[10px] text-zinc-500">
              Delete/Backspace to remove
            </p>
            <p className="text-[10px] text-zinc-500">Ctrl+Z to undo</p>
          </div>
        </div>

        {/* Center: Canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 cursor-crosshair overflow-hidden"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          style={{ userSelect: "none" }}
        >
          {/* Grid background */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
            }}
          />

          {/* Transform container */}
          <div
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            {/* SVG layer for transitions */}
            <svg
              className="pointer-events-none absolute left-0 top-0"
              style={{ width: 9999, height: 9999, overflow: "visible" }}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#71717a" />
                </marker>
                <marker
                  id="arrowhead-selected"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 8 3, 0 6" fill="#18181b" />
                </marker>
              </defs>

              {/* Transition curves */}
              {transitionPaths.map((tp) => {
                if (!tp) return null;
                const isSelected = tp.id === selectedTransitionId;
                return (
                  <g key={tp.id}>
                    {/* Hit area (wider invisible path) */}
                    <path
                      d={tp.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTransitionId(tp.id);
                        setSelectedNodeId(null);
                      }}
                    />
                    {/* Visible path */}
                    <path
                      d={tp.d}
                      fill="none"
                      stroke={isSelected ? "#18181b" : "#71717a"}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      strokeDasharray={isSelected ? "none" : "none"}
                      markerEnd={
                        isSelected
                          ? "url(#arrowhead-selected)"
                          : "url(#arrowhead)"
                      }
                    />
                    {/* Label */}
                    {tp.label && (
                      <text
                        x={tp.midX}
                        y={tp.midY - 6}
                        textAnchor="middle"
                        className="pointer-events-none fill-zinc-600"
                        style={{
                          fontSize: 10,
                          fontFamily: "monospace",
                          fontWeight: 600,
                        }}
                      >
                        {tp.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Connecting line preview */}
              {connecting && (
                <line
                  x1={
                    nodes[connecting.fromNodeId].position.x + NODE_W / 2
                  }
                  y1={
                    nodes[connecting.fromNodeId].position.y + NODE_H
                  }
                  x2={connecting.mouseX}
                  y2={connecting.mouseY}
                  stroke="#a1a1aa"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
              )}
            </svg>

            {/* DOM nodes */}
            {Object.values(nodes).map((node) => {
              const cfg = nodeTypeConfig[node.type];
              const isSelected = node.id === selectedNodeId;
              const isEntry = node.id === entryNodeId;
              const label =
                node.type === "state"
                  ? (node.data as { label?: string }).label || "State"
                  : node.type === "end"
                    ? (node.data as { label?: string }).label || "End"
                    : cfg.label;

              const customColor =
                node.type === "state"
                  ? (node.data as { color?: string }).color
                  : undefined;

              return (
                <div
                  key={node.id}
                  className={`group absolute flex items-center gap-2 border-2 bg-white shadow-sm transition-shadow ${
                    isSelected
                      ? "border-zinc-950 shadow-md"
                      : "border-zinc-300 hover:border-zinc-400"
                  } ${
                    node.type === "condition"
                      ? "rotate-0"
                      : node.type === "trigger"
                        ? "rounded-full"
                        : node.type === "end"
                          ? "rounded-full"
                          : "rounded"
                  }`}
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    width: NODE_W,
                    height: NODE_H,
                    cursor: draggingNodeId === node.id ? "grabbing" : "grab",
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id, false)}
                >
                  {/* Color bar */}
                  <div
                    className={`h-full w-2 shrink-0 ${customColor || cfg.color} ${
                      node.type === "trigger" || node.type === "end"
                        ? "rounded-l-full"
                        : "rounded-l-sm"
                    }`}
                  />

                  <div className="flex min-w-0 flex-1 flex-col px-1 py-1">
                    <span className="truncate font-mono text-[10px] font-bold uppercase text-zinc-500">
                      {cfg.label}
                    </span>
                    <span className="truncate text-xs font-bold">
                      {label}
                    </span>
                  </div>

                  {isEntry && (
                    <span className="mr-2 rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700">
                      ENTRY
                    </span>
                  )}

                  {/* Input port (top center) */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-400 bg-white transition-colors hover:border-zinc-950 hover:bg-zinc-100"
                    style={{
                      top: 0,
                      width: PORT_R * 2,
                      height: PORT_R * 2,
                    }}
                    onMouseUp={(e) => {
                      if (connecting && connecting.fromNodeId !== node.id) {
                        e.stopPropagation();
                        pushUndo();
                        const newTransition: WorkflowTransition = {
                          id: crypto.randomUUID(),
                          fromNodeId: connecting.fromNodeId,
                          toNodeId: node.id,
                        };
                        setTransitions((prev) => [...prev, newTransition]);
                        setConnecting(null);
                      }
                    }}
                  />

                  {/* Output port (bottom center) */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 translate-y-1/2 cursor-crosshair rounded-full border-2 border-zinc-400 bg-white transition-colors hover:border-zinc-950 hover:bg-zinc-100"
                    style={{
                      bottom: 0,
                      width: PORT_R * 2,
                      height: PORT_R * 2,
                    }}
                    onMouseDown={(e) =>
                      handleNodeMouseDown(e, node.id, true)
                    }
                  />
                </div>
              );
            })}
          </div>

          {/* Zoom indicator */}
          <div className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[10px] text-zinc-500 shadow-sm">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Right: Property editor */}
        <div className="w-72 shrink-0 overflow-y-auto border-l-2 border-zinc-950 bg-white p-4">
          {selectedNode ? (
            <NodeEditor
              node={selectedNode}
              isEntry={selectedNode.id === entryNodeId}
              onChange={(updated) => {
                pushUndo();
                setNodes((prev) => ({ ...prev, [updated.id]: updated }));
              }}
              onSetEntry={() => setEntryNodeId(selectedNode.id)}
            />
          ) : selectedTransition ? (
            <TransitionEditor
              transition={selectedTransition}
              nodes={nodes}
              onChange={(updated) => {
                pushUndo();
                setTransitions((prev) =>
                  prev.map((t) => (t.id === updated.id ? updated : t)),
                );
              }}
            />
          ) : (
            <div className="text-center text-sm text-zinc-400">
              <p className="font-mono text-xs font-bold uppercase">
                Properties
              </p>
              <p className="mt-4">Select a node or transition to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Node Editor ----

function NodeEditor({
  node,
  isEntry,
  onChange,
  onSetEntry,
}: {
  node: WorkflowNode;
  isEntry: boolean;
  onChange: (updated: WorkflowNode) => void;
  onSetEntry: () => void;
}) {
  const cfg = nodeTypeConfig[node.type];

  function updateData(patch: Record<string, unknown>) {
    onChange({ ...node, data: { ...node.data, ...patch } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded text-xs text-white ${cfg.color}`}
        >
          {cfg.icon}
        </span>
        <span className="font-mono text-xs font-bold uppercase">
          {cfg.label} Node
        </span>
      </div>

      {!isEntry && node.type === "trigger" && (
        <button
          onClick={onSetEntry}
          className="w-full border-2 border-amber-400 px-3 py-1 font-mono text-[10px] font-bold uppercase text-amber-600 hover:bg-amber-50"
        >
          Set as Entry
        </button>
      )}

      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          ID
        </label>
        <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">
          {node.id}
        </p>
      </div>

      {/* Type-specific editors */}
      {node.type === "trigger" && (
        <TriggerEditor
          data={node.data as { event?: string; conditions?: WorkflowCondition[] }}
          onChange={updateData}
        />
      )}
      {node.type === "state" && (
        <StateEditor
          data={
            node.data as {
              label?: string;
              color?: string;
              slaMinutes?: number;
              mandatoryFields?: string[];
              onEnterActions?: WorkflowAction[];
            }
          }
          onChange={updateData}
        />
      )}
      {node.type === "condition" && (
        <ConditionEditor
          data={
            node.data as {
              logic?: string;
              conditions?: WorkflowCondition[];
            }
          }
          onChange={updateData}
        />
      )}
      {node.type === "action" && (
        <ActionEditor
          data={node.data as { actions?: WorkflowAction[] }}
          onChange={updateData}
        />
      )}
      {node.type === "delay" && (
        <DelayEditor
          data={
            node.data as { type?: string; minutes?: number; event?: string }
          }
          onChange={updateData}
        />
      )}
      {node.type === "end" && (
        <EndEditor
          data={node.data as { label?: string }}
          onChange={updateData}
        />
      )}
    </div>
  );
}

// ---- Type-specific editors ----

function TriggerEditor({
  data,
  onChange,
}: {
  data: { event?: string; conditions?: WorkflowCondition[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Event
        </label>
        <select
          value={data.event || "create"}
          onChange={(e) => onChange({ event: e.target.value })}
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        >
          {EVENTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
      <ConditionRows
        label="Entry Conditions"
        conditions={data.conditions || []}
        onChange={(conditions) => onChange({ conditions })}
      />
    </div>
  );
}

function StateEditor({
  data,
  onChange,
}: {
  data: {
    label?: string;
    color?: string;
    slaMinutes?: number;
    mandatoryFields?: string[];
    onEnterActions?: WorkflowAction[];
  };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-purple-500",
    "bg-red-500",
    "bg-teal-500",
    "bg-pink-500",
    "bg-zinc-400",
  ];

  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Label
        </label>
        <input
          type="text"
          value={data.label || ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Color
        </label>
        <div className="mt-1 flex flex-wrap gap-1">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ color: c })}
              className={`h-5 w-5 rounded-sm ${c} ${
                data.color === c
                  ? "ring-2 ring-zinc-950 ring-offset-1"
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          SLA (minutes)
        </label>
        <input
          type="number"
          value={data.slaMinutes || ""}
          onChange={(e) =>
            onChange({
              slaMinutes: e.target.value ? parseInt(e.target.value) : undefined,
            })
          }
          placeholder="e.g. 60"
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>
      <ActionRows
        label="On-Enter Actions"
        actions={data.onEnterActions || []}
        onChange={(onEnterActions) => onChange({ onEnterActions })}
      />
    </div>
  );
}

function ConditionEditor({
  data,
  onChange,
}: {
  data: { logic?: string; conditions?: WorkflowCondition[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Logic
        </label>
        <div className="mt-1 flex gap-2">
          {(["all", "any"] as const).map((l) => (
            <button
              key={l}
              onClick={() => onChange({ logic: l })}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${
                data.logic === l
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 text-zinc-500"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <ConditionRows
        label="Conditions"
        conditions={data.conditions || []}
        onChange={(conditions) => onChange({ conditions })}
      />
    </div>
  );
}

function ActionEditor({
  data,
  onChange,
}: {
  data: { actions?: WorkflowAction[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <ActionRows
      label="Actions"
      actions={data.actions || []}
      onChange={(actions) => onChange({ actions })}
    />
  );
}

function DelayEditor({
  data,
  onChange,
}: {
  data: { type?: string; minutes?: number; event?: string };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Delay Type
        </label>
        <div className="mt-1 flex gap-2">
          {(["time", "event"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ type: t })}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${
                data.type === t
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 text-zinc-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {data.type === "time" ? (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Minutes
          </label>
          <input
            type="number"
            value={data.minutes || ""}
            onChange={(e) =>
              onChange({ minutes: parseInt(e.target.value) || 0 })
            }
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          />
        </div>
      ) : (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Wait for Event
          </label>
          <select
            value={data.event || "reply"}
            onChange={(e) => onChange({ event: e.target.value })}
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          >
            {EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function EndEditor({
  data,
  onChange,
}: {
  data: { label?: string };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
        Label
      </label>
      <input
        type="text"
        value={data.label || ""}
        onChange={(e) => onChange({ label: e.target.value })}
        className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
      />
    </div>
  );
}

// ---- Transition Editor ----

function TransitionEditor({
  transition,
  nodes,
  onChange,
}: {
  transition: WorkflowTransition;
  nodes: Record<string, WorkflowNode>;
  onChange: (updated: WorkflowTransition) => void;
}) {
  const fromNode = nodes[transition.fromNodeId];
  const toNode = nodes[transition.toNodeId];

  return (
    <div className="space-y-4">
      <p className="font-mono text-xs font-bold uppercase">Transition</p>

      <div className="space-y-1 text-xs">
        <p className="text-zinc-500">
          <span className="font-bold">From:</span>{" "}
          {fromNode
            ? `${nodeTypeConfig[fromNode.type].label}: ${getNodeDisplayLabel(fromNode)}`
            : transition.fromNodeId}
        </p>
        <p className="text-zinc-500">
          <span className="font-bold">To:</span>{" "}
          {toNode
            ? `${nodeTypeConfig[toNode.type].label}: ${getNodeDisplayLabel(toNode)}`
            : transition.toNodeId}
        </p>
      </div>

      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Label
        </label>
        <input
          type="text"
          value={transition.label || ""}
          onChange={(e) =>
            onChange({ ...transition, label: e.target.value || undefined })
          }
          placeholder="e.g. Approve"
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>

      {fromNode?.type === "condition" && (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Branch Key
          </label>
          <select
            value={transition.branchKey || ""}
            onChange={(e) =>
              onChange({
                ...transition,
                branchKey: e.target.value || undefined,
              })
            }
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          >
            <option value="">None</option>
            <option value="yes">Yes (match)</option>
            <option value="no">No (fallback)</option>
          </select>
        </div>
      )}

      <ConditionRows
        label="Conditions"
        conditions={transition.conditions || []}
        onChange={(conditions) =>
          onChange({
            ...transition,
            conditions: conditions.length > 0 ? conditions : undefined,
          })
        }
      />

      <ActionRows
        label="Actions"
        actions={transition.actions || []}
        onChange={(actions) =>
          onChange({
            ...transition,
            actions: actions.length > 0 ? actions : undefined,
          })
        }
      />
    </div>
  );
}

// ---- Shared condition/action row editors ----

function ConditionRows({
  label,
  conditions,
  onChange,
}: {
  label: string;
  conditions: WorkflowCondition[];
  onChange: (conditions: WorkflowCondition[]) => void;
}) {
  function addRow() {
    onChange([...conditions, { field: "status", operator: "is", value: "" }]);
  }

  function updateRow(idx: number, patch: Partial<WorkflowCondition>) {
    const next = [...conditions];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(conditions.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-bold uppercase text-zinc-500">
          {label}
        </label>
        <button
          onClick={addRow}
          className="font-mono text-[10px] font-bold text-zinc-400 hover:text-zinc-950"
        >
          + Add
        </button>
      </div>
      {conditions.map((c, i) => (
        <div key={i} className="mt-1.5 space-y-1 rounded border border-zinc-200 p-1.5">
          <div className="flex gap-1">
            <select
              value={c.field}
              onChange={(e) => updateRow(i, { field: e.target.value })}
              className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
            >
              {FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              value={c.operator}
              onChange={(e) => updateRow(i, { operator: e.target.value })}
              className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={String(c.value ?? "")}
              onChange={(e) => updateRow(i, { value: e.target.value })}
              placeholder="value"
              className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
            />
            <button
              onClick={() => removeRow(i)}
              className="px-1 text-[10px] text-red-400 hover:text-red-600"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionRows({
  label,
  actions,
  onChange,
}: {
  label: string;
  actions: WorkflowAction[];
  onChange: (actions: WorkflowAction[]) => void;
}) {
  function addRow() {
    onChange([...actions, { type: "add_tag", value: "" }]);
  }

  function updateRow(idx: number, patch: Partial<WorkflowAction>) {
    const next = [...actions];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeRow(idx: number) {
    onChange(actions.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] font-bold uppercase text-zinc-500">
          {label}
        </label>
        <button
          onClick={addRow}
          className="font-mono text-[10px] font-bold text-zinc-400 hover:text-zinc-950"
        >
          + Add
        </button>
      </div>
      {actions.map((a, i) => (
        <div key={i} className="mt-1.5 flex gap-1 rounded border border-zinc-200 p-1.5">
          <select
            value={a.type}
            onChange={(e) => updateRow(i, { type: e.target.value })}
            className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={String(a.value ?? "")}
            onChange={(e) => updateRow(i, { value: e.target.value })}
            placeholder="value"
            className="flex-1 border border-zinc-200 px-1 py-0.5 font-mono text-[10px] focus:outline-none"
          />
          <button
            onClick={() => removeRow(i)}
            className="px-1 text-[10px] text-red-400 hover:text-red-600"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Helpers ----

function getNodeDisplayLabel(node: WorkflowNode): string {
  if (node.type === "state")
    return (node.data as { label?: string }).label || "State";
  if (node.type === "end")
    return (node.data as { label?: string }).label || "End";
  return nodeTypeConfig[node.type].label;
}
