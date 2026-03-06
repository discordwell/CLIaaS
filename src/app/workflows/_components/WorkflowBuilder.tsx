"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
  type NodeProps,
  BackgroundVariant,
  Panel,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  Workflow,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTransition,
} from "./types";
import { nodeTypeConfig, getNodeDisplayLabel } from "./types";
import { NodeEditor } from "./NodeEditors";
import { TransitionEditor } from "./TransitionEditor";
import { validateWorkflow } from "@/lib/workflow/decomposer";
import type { ValidationError } from "@/lib/workflow/decomposer";

// ---- Custom Node Component ----

function WorkflowNodeComponent({ data, selected }: NodeProps) {
  const type = data.nodeType as WorkflowNodeType;
  const cfg = nodeTypeConfig[type];
  const label = data.displayLabel as string || cfg?.label || type;
  const isEntry = data.isEntry as boolean;
  const hasError = data.hasError as boolean;
  const hasWarning = data.hasWarning as boolean;
  const customColor = data.customColor as string | undefined;

  return (
    <div
      className={`flex items-center gap-2 border-2 bg-white shadow-sm transition-shadow ${
        selected ? "border-zinc-950 shadow-md" : "border-zinc-300 hover:border-zinc-400"
      } ${type === "trigger" || type === "end" ? "rounded-full" : "rounded"}`}
      style={{ width: 160, height: 56 }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-white"
      />

      <div
        className={`h-full w-2 shrink-0 ${customColor || cfg?.color || "bg-zinc-500"} ${
          type === "trigger" || type === "end" ? "rounded-l-full" : "rounded-l-sm"
        }`}
      />

      <div className="flex min-w-0 flex-1 flex-col px-1 py-1">
        <span className="truncate font-mono text-[10px] font-bold uppercase text-zinc-500">
          {cfg?.label || type}
        </span>
        <span className="truncate text-xs font-bold">{label}</span>
      </div>

      {isEntry && (
        <span className="mr-2 rounded bg-amber-100 px-1 py-0.5 text-[8px] font-bold text-amber-700">
          ENTRY
        </span>
      )}

      {(hasError || hasWarning) && (
        <div
          className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${
            hasError ? "bg-red-500" : "bg-amber-500"
          }`}
        />
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-zinc-950"
      />
    </div>
  );
}

const workflowNodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeComponent,
};

// ---- Conversion helpers ----

function workflowToReactFlow(
  nodes: Record<string, WorkflowNode>,
  transitions: WorkflowTransition[],
  entryNodeId: string,
  nodeIssues: Map<string, ValidationError[]>,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const rfNodes: Node[] = Object.values(nodes).map((n) => ({
    id: n.id,
    type: "workflowNode",
    position: n.position,
    data: {
      nodeType: n.type,
      displayLabel: getNodeDisplayLabel(n),
      isEntry: n.id === entryNodeId,
      hasError: nodeIssues.get(n.id)?.some((e) => e.severity === "error") ?? false,
      hasWarning: nodeIssues.get(n.id)?.some((e) => e.severity === "warning") ?? false,
      customColor: n.type === "state" ? (n.data as { color?: string }).color : undefined,
      ...n.data,
    },
  }));

  const rfEdges: Edge[] = transitions.map((t) => ({
    id: t.id,
    source: t.fromNodeId,
    target: t.toNodeId,
    label: t.label,
    type: "smoothstep",
    style: { strokeWidth: 2, stroke: "#71717a" },
    data: { transitionData: t },
  }));

  return { rfNodes, rfEdges };
}

function reactFlowToWorkflow(
  rfNodes: Node[],
  rfEdges: Edge[],
): { nodes: Record<string, WorkflowNode>; transitions: WorkflowTransition[] } {
  const nodes: Record<string, WorkflowNode> = {};
  for (const n of rfNodes) {
    const { nodeType, displayLabel, isEntry, hasError, hasWarning, customColor, ...data } = n.data as Record<string, unknown>;
    nodes[n.id] = {
      id: n.id,
      type: nodeType as WorkflowNodeType,
      data: data as Record<string, unknown>,
      position: n.position,
    };
  }

  const transitions: WorkflowTransition[] = rfEdges.map((e) => {
    const td = (e.data as Record<string, unknown>)?.transitionData as WorkflowTransition | undefined;
    return td ?? {
      id: e.id,
      fromNodeId: e.source,
      toNodeId: e.target,
      label: e.label as string | undefined,
    };
  });

  return { nodes, transitions };
}

// ---- Main component (inner) ----

function WorkflowBuilderInner({
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
  const [wfNodes, setWfNodes] = useState(workflow.nodes);
  const [wfTransitions, setWfTransitions] = useState(workflow.transitions);
  const [entryNodeId, setEntryNodeId] = useState(workflow.entryNodeId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizePreview, setOptimizePreview] = useState<{
    changes: Array<{ type: string; description: string; nodeId?: string }>;
    workflow: Workflow;
  } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hoveredType, setHoveredType] = useState<WorkflowNodeType | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("cliaas-wf-onboarding-dismissed")) {
      setShowOnboarding(true);
    }
  }, []);

  // Undo stack
  const undoStackRef = useRef<
    Array<{ nodes: Record<string, WorkflowNode>; transitions: WorkflowTransition[] }>
  >([]);

  const wfNodesRef = useRef(wfNodes);
  wfNodesRef.current = wfNodes;
  const wfTransitionsRef = useRef(wfTransitions);
  wfTransitionsRef.current = wfTransitions;

  function pushUndo() {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      {
        nodes: JSON.parse(JSON.stringify(wfNodesRef.current)),
        transitions: JSON.parse(JSON.stringify(wfTransitionsRef.current)),
      },
    ];
  }

  function undo() {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setWfNodes(last.nodes);
    setWfTransitions(last.transitions);
  }

  // Validation
  const validation = useMemo(() => {
    const wf: Workflow = { ...workflow, nodes: wfNodes, transitions: wfTransitions, entryNodeId };
    return validateWorkflow(wf);
  }, [workflow, wfNodes, wfTransitions, entryNodeId]);

  const errorCount = validation.errors.filter((e) => e.severity === "error").length;
  const warningCount = validation.errors.filter((e) => e.severity === "warning").length;
  const validationColor = errorCount > 0 ? "bg-red-500" : warningCount > 0 ? "bg-amber-500" : "bg-emerald-500";

  const nodeIssues = useMemo(() => {
    const map = new Map<string, ValidationError[]>();
    for (const err of validation.errors) {
      if (err.nodeId) {
        const list = map.get(err.nodeId) || [];
        list.push(err);
        map.set(err.nodeId, list);
      }
    }
    return map;
  }, [validation.errors]);

  // Convert to React Flow format
  const { rfNodes: initialNodes, rfEdges: initialEdges } = useMemo(
    () => workflowToReactFlow(wfNodes, wfTransitions, entryNodeId, nodeIssues),
    [wfNodes, wfTransitions, entryNodeId, nodeIssues],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync React Flow state back when wfNodes/wfTransitions change
  useEffect(() => {
    const { rfNodes, rfEdges } = workflowToReactFlow(wfNodes, wfTransitions, entryNodeId, nodeIssues);
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [wfNodes, wfTransitions, entryNodeId, nodeIssues, setNodes, setEdges]);

  // Sync position changes from React Flow back to workflow state
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      setWfNodes((prev) => ({
        ...prev,
        [node.id]: { ...prev[node.id], position: node.position },
      }));
    },
    [],
  );

  function suggestTransitionLabel(fromNodeId: string, toNodeId: string): string | undefined {
    const to = wfNodes[toNodeId];
    if (!to) return undefined;
    if (to.type === "end") return "Close";
    if (to.type === "state") return (to.data as { label?: string }).label || undefined;
    return undefined;
  }

  const onConnect = useCallback(
    (params: Connection) => {
      pushUndo();
      const newTransition: WorkflowTransition = {
        id: crypto.randomUUID(),
        fromNodeId: params.source!,
        toNodeId: params.target!,
        label: suggestTransitionLabel(params.source!, params.target!),
      };
      setWfTransitions((prev) => [...prev, newTransition]);
    },
    [wfNodes],
  );

  // Add node from palette
  function addNode(type: WorkflowNodeType) {
    pushUndo();
    const id = crypto.randomUUID();
    const defaultData: Record<WorkflowNodeType, Record<string, unknown>> = {
      trigger: { event: "create" },
      state: { label: "New State", color: "bg-blue-500" },
      condition: { logic: "all", conditions: [{ field: "status", operator: "is", value: "open" }] },
      action: { actions: [{ type: "add_tag", value: "processed" }] },
      delay: { type: "time", minutes: 60 },
      end: { label: "End" },
    };
    const newNode: WorkflowNode = {
      id,
      type,
      data: defaultData[type],
      position: { x: 300, y: 200 },
    };
    setWfNodes((prev) => ({ ...prev, [id]: newNode }));
    setSelectedNodeId(id);
    setSelectedTransitionId(null);
  }

  // Delete handler
  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      pushUndo();
      if (deletedNodes.length > 0) {
        const ids = new Set(deletedNodes.map((n) => n.id));
        setWfNodes((prev) => {
          const next = { ...prev };
          for (const id of ids) delete next[id];
          return next;
        });
        setWfTransitions((prev) => prev.filter((t) => !ids.has(t.fromNodeId) && !ids.has(t.toNodeId)));
        if (selectedNodeId && ids.has(selectedNodeId)) setSelectedNodeId(null);
      }
      if (deletedEdges.length > 0) {
        const ids = new Set(deletedEdges.map((e) => e.id));
        setWfTransitions((prev) => prev.filter((t) => !ids.has(t.id)));
        if (selectedTransitionId && ids.has(selectedTransitionId)) setSelectedTransitionId(null);
      }
    },
    [selectedNodeId, selectedTransitionId],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedTransitionId(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Save
  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ ...workflow, nodes: wfNodes, transitions: wfTransitions, entryNodeId });
    } finally {
      setSaving(false);
    }
  }

  // Optimize
  async function handleOptimizeDryRun() {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/optimize?dryRun=true`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.changes?.length > 0) {
          setOptimizePreview(data);
          setShowValidation(true);
        }
      }
    } finally {
      setOptimizing(false);
    }
  }

  function handleOptimizeApply() {
    if (!optimizePreview) return;
    pushUndo();
    setWfNodes(optimizePreview.workflow.nodes);
    setWfTransitions(optimizePreview.workflow.transitions);
    setEntryNodeId(optimizePreview.workflow.entryNodeId);
    setOptimizePreview(null);
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
          setWfNodes(wf.nodes);
          setWfTransitions(wf.transitions);
          setEntryNodeId(wf.entryNodeId);
        }
      } catch {
        // Invalid JSON
      }
    };
    input.click();
  }

  const selectedNode = selectedNodeId ? wfNodes[selectedNodeId] : null;
  const selectedTransition = selectedTransitionId
    ? wfTransitions.find((t) => t.id === selectedTransitionId)
    : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-100 text-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 bg-white px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950">
            &larr; Back
          </button>
          <span className="font-mono text-xs text-zinc-400">|</span>
          <span className="font-mono text-sm font-bold">{workflow.name}</span>
          <span className="font-mono text-xs text-zinc-400">v{workflow.version}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950">
            Import
          </button>
          <button onClick={onExport} className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950">
            Export JSON
          </button>
          <button
            onClick={() => { setShowValidation(!showValidation); setOptimizePreview(null); }}
            className="relative flex items-center gap-1.5 border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
            title={`${errorCount} error(s), ${warningCount} warning(s)`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${validationColor}`} />
            {errorCount + warningCount > 0 && <span>{errorCount + warningCount}</span>}
          </button>
          <button
            onClick={handleOptimizeDryRun}
            disabled={optimizing}
            className="border-2 border-amber-400 px-3 py-1 font-mono text-xs font-bold uppercase text-amber-600 hover:bg-amber-50 disabled:opacity-50"
          >
            {optimizing ? "..." : "Optimize"}
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
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">Add Node</p>
          <div className="mt-3 space-y-1.5">
            {(Object.entries(nodeTypeConfig) as [WorkflowNodeType, typeof nodeTypeConfig[WorkflowNodeType]][]).map(
              ([type, cfg]) => (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  onMouseEnter={() => setHoveredType(type)}
                  onMouseLeave={() => setHoveredType(null)}
                  title={cfg.description}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs font-bold hover:bg-zinc-100"
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded text-[10px] text-white ${cfg.color}`}>
                    {cfg.icon}
                  </span>
                  <span className="uppercase">{cfg.label}</span>
                </button>
              ),
            )}
          </div>
          {hoveredType && (
            <p className="mt-2 text-[10px] text-zinc-500">{nodeTypeConfig[hoveredType].description}</p>
          )}
          <div className="mt-6 border-t border-zinc-200 pt-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">Controls</p>
            <p className="mt-2 text-[10px] text-zinc-500">Drag nodes to position</p>
            <p className="text-[10px] text-zinc-500">Drag from port to connect</p>
            <p className="text-[10px] text-zinc-500">Delete/Backspace to remove</p>
            <p className="text-[10px] text-zinc-500">Ctrl+Z to undo</p>
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={workflowNodeTypes}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedTransitionId(null); }}
            onEdgeClick={(_, edge) => { setSelectedTransitionId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedTransitionId(null); }}
            onDelete={onDelete}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            snapToGrid
            snapGrid={[10, 10]}
            deleteKeyCode={["Delete", "Backspace"]}
            minZoom={0.25}
            maxZoom={2}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { strokeWidth: 2, stroke: "#71717a" },
              markerEnd: { type: "arrowclosed" as unknown as string, color: "#71717a" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d4d4d8" />
            <Controls showInteractive={false} />
            <MiniMap
              zoomable
              pannable
              style={{ border: "2px solid #09090b", borderRadius: 0 }}
              maskColor="rgba(9,9,11,0.08)"
            />
          </ReactFlow>

          {/* Onboarding panel */}
          {showOnboarding && (
            <div className="absolute bottom-12 right-4 z-20 max-w-xs border-2 border-zinc-950 bg-white p-4 shadow-lg">
              <p className="font-mono text-xs font-bold uppercase tracking-widest">Getting Started</p>
              <ul className="mt-3 space-y-1.5 text-[11px] text-zinc-600">
                <li>Click node types in the left palette to add them</li>
                <li>Drag from a port to connect nodes</li>
                <li>Scroll to zoom, drag canvas to pan</li>
                <li>Click a node or edge to edit its properties</li>
              </ul>
              <button
                onClick={() => {
                  setShowOnboarding(false);
                  localStorage.setItem("cliaas-wf-onboarding-dismissed", "1");
                }}
                className="mt-3 w-full border-2 border-zinc-950 bg-zinc-950 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Got it
              </button>
            </div>
          )}
        </div>

        {/* Right: Property editor / Validation panel */}
        <div className="w-72 shrink-0 overflow-y-auto border-l-2 border-zinc-950 bg-white p-4">
          {showValidation && optimizePreview ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold uppercase">Optimize Preview</p>
                <button onClick={() => { setShowValidation(false); setOptimizePreview(null); }} className="font-mono text-[10px] text-zinc-400 hover:text-zinc-950">Close</button>
              </div>
              <p className="mt-2 text-[10px] text-zinc-500">
                {optimizePreview.changes.length} fix{optimizePreview.changes.length !== 1 ? "es" : ""} available:
              </p>
              <div className="mt-3 space-y-1.5">
                {optimizePreview.changes.map((c, i) => (
                  <div key={i} className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-700">
                    <span className="font-mono font-bold uppercase">{c.type.replace(/_/g, " ")}</span> {c.description}
                  </div>
                ))}
              </div>
              <button onClick={handleOptimizeApply} className="mt-4 w-full border-2 border-zinc-950 bg-zinc-950 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800">
                Apply Changes
              </button>
            </div>
          ) : showValidation ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold uppercase">Validation</p>
                <button onClick={() => setShowValidation(false)} className="font-mono text-[10px] text-zinc-400 hover:text-zinc-950">Close</button>
              </div>
              {validation.errors.length === 0 ? (
                <p className="mt-4 text-center text-xs text-emerald-600">All checks passed</p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {validation.errors.map((err, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (err.nodeId) {
                          setSelectedNodeId(err.nodeId);
                          setSelectedTransitionId(null);
                          setShowValidation(false);
                        }
                      }}
                      className={`w-full rounded border p-2 text-left text-[10px] ${
                        err.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"
                      } ${err.nodeId ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                    >
                      <span className="font-mono font-bold uppercase">{err.severity}</span> {err.message}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : selectedNode ? (
            <NodeEditor
              node={selectedNode}
              isEntry={selectedNode.id === entryNodeId}
              onChange={(updated) => {
                pushUndo();
                setWfNodes((prev) => ({ ...prev, [updated.id]: updated }));
              }}
              onSetEntry={() => setEntryNodeId(selectedNode.id)}
            />
          ) : selectedTransition ? (
            <TransitionEditor
              transition={selectedTransition}
              nodes={wfNodes}
              onChange={(updated) => {
                pushUndo();
                setWfTransitions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
              }}
            />
          ) : (
            <div className="text-center text-sm text-zinc-400">
              <p className="font-mono text-xs font-bold uppercase">Properties</p>
              <p className="mt-4">Select a node or transition to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Exported wrapper with ReactFlowProvider ----

export function WorkflowBuilder(props: {
  workflow: Workflow;
  onSave: (updated: Workflow) => void;
  onCancel: () => void;
  onExport: () => void;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner {...props} />
    </ReactFlowProvider>
  );
}
