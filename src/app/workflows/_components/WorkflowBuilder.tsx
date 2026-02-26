"use client";

import { useEffect, useState, useRef, useMemo } from "react";
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

const NODE_W = 160;
const NODE_H = 56;
const PORT_R = 6;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

export function WorkflowBuilder({
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
  const [showValidation, setShowValidation] = useState(false);
  const [hoveredType, setHoveredType] = useState<WorkflowNodeType | null>(null);
  const [hoveredTargetNodeId, setHoveredTargetNodeId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== "undefined") {
      return !localStorage.getItem("cliaas-wf-onboarding-dismissed");
    }
    return true;
  });
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

  // Real-time validation
  const validation = useMemo(() => {
    const wf: Workflow = {
      ...workflow,
      nodes,
      transitions,
      entryNodeId,
    };
    return validateWorkflow(wf);
  }, [workflow, nodes, transitions, entryNodeId]);

  const errorCount = validation.errors.filter(e => e.severity === 'error').length;
  const warningCount = validation.errors.filter(e => e.severity === 'warning').length;
  const validationColor = errorCount > 0 ? 'bg-red-500' : warningCount > 0 ? 'bg-amber-500' : 'bg-emerald-500';

  // Map nodeId → validation issues for canvas indicators
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

  // Auto-suggest transition label based on target node
  function suggestTransitionLabel(fromNodeId: string, toNodeId: string): string | undefined {
    const to = nodes[toNodeId];
    if (!to) return undefined;
    if (to.type === 'end') return 'Close';
    if (to.type === 'state') {
      return (to.data as { label?: string }).label || undefined;
    }
    return undefined;
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
      const mx = (e.clientX - rect.left - panOffset.x) / zoom;
      const my = (e.clientY - rect.top - panOffset.y) / zoom;

      // Track closest target for snap feedback
      let closestId: string | null = null;
      for (const node of Object.values(nodes)) {
        if (node.id === connecting.fromNodeId) continue;
        const nx = node.position.x + NODE_W / 2;
        const ny = node.position.y;
        if (Math.abs(mx - nx) < 30 && Math.abs(my - ny) < 20) {
          closestId = node.id;
          break;
        }
      }
      setHoveredTargetNodeId(closestId);

      setConnecting({
        ...connecting,
        mouseX: closestId ? nodes[closestId].position.x + NODE_W / 2 : mx,
        mouseY: closestId ? nodes[closestId].position.y : my,
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
              label: suggestTransitionLabel(connecting.fromNodeId, node.id),
            };
            setTransitions((prev) => [...prev, newTransition]);
            break;
          }
        }
      }
      setConnecting(null);
      setHoveredTargetNodeId(null);
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
            onClick={() => setShowValidation(!showValidation)}
            className="relative flex items-center gap-1.5 border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
            title={`${errorCount} error(s), ${warningCount} warning(s)`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${validationColor}`} />
            {errorCount + warningCount > 0 && (
              <span>{errorCount + warningCount}</span>
            )}
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
                  onMouseEnter={() => setHoveredType(type)}
                  onMouseLeave={() => setHoveredType(null)}
                  title={cfg.description}
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
          {hoveredType && (
            <p className="mt-2 text-[10px] text-zinc-500">
              {nodeTypeConfig[hoveredType].description}
            </p>
          )}
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

              {/* Connecting bezier preview */}
              {connecting && (() => {
                const cx1 = nodes[connecting.fromNodeId].position.x + NODE_W / 2;
                const cy1 = nodes[connecting.fromNodeId].position.y + NODE_H;
                const cx2 = connecting.mouseX;
                const cy2 = connecting.mouseY;
                const cdy = Math.abs(cy2 - cy1);
                const ccp = Math.max(40, cdy * 0.4);
                const isSnapped = hoveredTargetNodeId !== null;
                return (
                  <path
                    d={`M ${cx1} ${cy1} C ${cx1} ${cy1 + ccp}, ${cx2} ${cy2 - ccp}, ${cx2} ${cy2}`}
                    fill="none"
                    stroke={isSnapped ? "#18181b" : "#a1a1aa"}
                    strokeWidth={isSnapped ? 2 : 1.5}
                    strokeDasharray={isSnapped ? "none" : "5 3"}
                  />
                );
              })()}
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

                  {/* Validation dot indicator */}
                  {nodeIssues.has(node.id) && (
                    <div
                      className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${
                        nodeIssues.get(node.id)!.some(e => e.severity === 'error')
                          ? 'bg-red-500'
                          : 'bg-amber-500'
                      }`}
                      title={nodeIssues.get(node.id)!.map(e => e.message).join(', ')}
                    />
                  )}

                  {/* Input port (top center) — larger hit area wrapping visual port */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                    style={{ top: 0, width: 24, height: 24 }}
                    onMouseUp={(e) => {
                      if (connecting && connecting.fromNodeId !== node.id) {
                        e.stopPropagation();
                        pushUndo();
                        const newTransition: WorkflowTransition = {
                          id: crypto.randomUUID(),
                          fromNodeId: connecting.fromNodeId,
                          toNodeId: node.id,
                          label: suggestTransitionLabel(connecting.fromNodeId, node.id),
                        };
                        setTransitions((prev) => [...prev, newTransition]);
                        setConnecting(null);
                      }
                    }}
                  >
                    <div
                      className={`rounded-full border-2 transition-colors ${
                        connecting && connecting.fromNodeId !== node.id
                          ? hoveredTargetNodeId === node.id
                            ? "border-zinc-950 bg-zinc-100 shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                            : "border-emerald-400 bg-white shadow-[0_0_6px_rgba(16,185,129,0.4)]"
                          : "border-zinc-400 bg-white hover:border-zinc-950 hover:bg-zinc-100"
                      }`}
                      style={{
                        width: PORT_R * 2,
                        height: PORT_R * 2,
                      }}
                    />
                  </div>

                  {/* Output port (bottom center) — larger hit area wrapping visual port */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 translate-y-1/2 flex cursor-crosshair items-center justify-center"
                    style={{ bottom: 0, width: 24, height: 24 }}
                    onMouseDown={(e) =>
                      handleNodeMouseDown(e, node.id, true)
                    }
                  >
                    <div
                      className="rounded-full border-2 border-zinc-400 bg-white transition-colors hover:border-zinc-950 hover:bg-zinc-100"
                      style={{
                        width: PORT_R * 2,
                        height: PORT_R * 2,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Onboarding panel */}
          {showOnboarding && (
            <div className="absolute bottom-12 right-4 z-20 max-w-xs border-2 border-zinc-950 bg-white p-4 shadow-lg">
              <p className="font-mono text-xs font-bold uppercase tracking-widest">
                Getting Started
              </p>
              <ul className="mt-3 space-y-1.5 text-[11px] text-zinc-600">
                <li>Click node types in the left palette to add them to the canvas</li>
                <li>Drag from a bottom port to a top port to connect nodes</li>
                <li>Shift+drag or middle-click to pan, scroll to zoom</li>
                <li>Click a node or transition to edit its properties</li>
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

          {/* Zoom indicator */}
          <div className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 font-mono text-[10px] text-zinc-500 shadow-sm">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Right: Property editor / Validation panel */}
        <div className="w-72 shrink-0 overflow-y-auto border-l-2 border-zinc-950 bg-white p-4">
          {showValidation ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold uppercase">Validation</p>
                <button
                  onClick={() => setShowValidation(false)}
                  className="font-mono text-[10px] text-zinc-400 hover:text-zinc-950"
                >
                  Close
                </button>
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
                        err.severity === 'error'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      } ${err.nodeId ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                    >
                      <span className="font-mono font-bold uppercase">
                        {err.severity}
                      </span>{' '}
                      {err.message}
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
