"use client";

import { useCallback, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  ReactFlowProvider,
} from "@xyflow/react";
import { FlowCanvasBase } from "@/components/flow-canvas/FlowCanvasBase";
import { chatbotNodeTypes } from "./nodes/BaseNode";
import { NodePalette } from "./NodePalette";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { TestChatPanel } from "./TestChatPanel";
import { flowToReactFlow, reactFlowToFlow } from "./flow-serialization";
import { useFlowHistory } from "@/components/flow-canvas/useFlowHistory";
import type { ChatbotFlow, ChatbotNodeType } from "@/lib/chatbot/types";

interface ChatbotFlowCanvasProps {
  flow: ChatbotFlow;
  onSave: (flow: ChatbotFlow) => Promise<void>;
  onPublish?: (flow: ChatbotFlow) => Promise<void>;
  onBack: () => void;
}

const DEFAULT_NODE_DATA: Record<ChatbotNodeType, Record<string, unknown>> = {
  message: { text: "New message", nodeType: "message", label: "Message" },
  buttons: { text: "Choose an option:", options: [], nodeType: "buttons", label: "Buttons" },
  branch: { field: "message", conditions: [], nodeType: "branch", label: "Branch" },
  action: { actionType: "set_tag", value: "", nodeType: "action", label: "Action" },
  handoff: { message: "Connecting you to an agent...", nodeType: "handoff", label: "Handoff" },
  ai_response: { systemPrompt: "You are a helpful support agent.", maxTokens: 300, nodeType: "ai_response", label: "AI Response" },
  article_suggest: { maxArticles: 3, nodeType: "article_suggest", label: "Article Suggest" },
  collect_input: { prompt: "Please enter your info:", variable: "input", validation: "none", nodeType: "collect_input", label: "Collect Input" },
  webhook: { url: "", method: "POST", nodeType: "webhook", label: "Webhook" },
  delay: { seconds: 3, nodeType: "delay", label: "Delay 3s" },
};

function ChatbotFlowCanvasInner({ flow, onSave, onPublish, onBack }: ChatbotFlowCanvasProps) {
  const initial = flowToReactFlow(flow);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  const { pushSnapshot, undo } = useFlowHistory(nodes, edges, setNodes, setEdges);

  const onConnect = useCallback(
    (params: Connection) => {
      pushSnapshot();
      setEdges((eds) => addEdge({ ...params, type: "smoothstep", style: { strokeWidth: 2, stroke: "#09090b" } }, eds));
    },
    [setEdges, pushSnapshot],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/chatbot-node-type") as ChatbotNodeType;
      if (!type || !DEFAULT_NODE_DATA[type]) return;

      const wrapper = reactFlowWrapperRef.current;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      const position = {
        x: event.clientX - rect.left - 90,
        y: event.clientY - rect.top - 30,
      };

      pushSnapshot();
      const id = crypto.randomUUID();
      const newNode: Node = {
        id,
        type: `chatbot_${type}`,
        position,
        data: { ...DEFAULT_NODE_DATA[type] },
      };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(id);
    },
    [setNodes, pushSnapshot],
  );

  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      pushSnapshot();
      if (deletedNodes.length > 0) {
        const ids = new Set(deletedNodes.map((n) => n.id));
        setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
        setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
      }
      if (deletedEdges.length > 0) {
        const ids = new Set(deletedEdges.map((e) => e.id));
        setEdges((eds) => eds.filter((e) => !ids.has(e.id)));
      }
    },
    [setNodes, setEdges, pushSnapshot],
  );

  function handleNodeUpdate(nodeId: string, data: Record<string, unknown>) {
    pushSnapshot();
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n)),
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = reactFlowToFlow(nodes, edges, flow);
      await onSave(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!onPublish) return;
    setPublishing(true);
    try {
      const updated = reactFlowToFlow(nodes, edges, flow);
      await onPublish(updated);
    } finally {
      setPublishing(false);
    }
  }

  // Keyboard undo
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    },
    [undo],
  );

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  return (
    <div className="flex h-screen flex-col bg-zinc-100 text-zinc-950" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 bg-white px-4 py-2">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950">
            &larr; Back
          </button>
          <span className="font-mono text-xs text-zinc-400">|</span>
          <span className="font-mono text-sm font-bold">{flow.name}</span>
          {flow.version && (
            <span className="font-mono text-xs text-zinc-400">v{flow.version}</span>
          )}
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTest(!showTest)}
            className="border-2 border-indigo-400 px-3 py-1 font-mono text-xs font-bold uppercase text-indigo-600 hover:bg-indigo-50"
          >
            {showTest ? "Close Test" : "Test"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="border-2 border-zinc-300 px-4 py-1 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          {onPublish && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {publishing ? "Publishing..." : "Publish"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Node palette */}
        <NodePalette />

        {/* Center: Canvas */}
        <div ref={reactFlowWrapperRef} className="relative flex-1">
          <FlowCanvasBase
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={chatbotNodeTypes}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDelete={onDelete}
          />
        </div>

        {/* Right: Detail panel or Test panel */}
        {showTest ? (
          <TestChatPanel flow={reactFlowToFlow(nodes, edges, flow)} onClose={() => setShowTest(false)} />
        ) : (
          <NodeDetailPanel
            node={selectedNode}
            allNodes={nodes}
            onUpdate={handleNodeUpdate}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

export function ChatbotFlowCanvas(props: ChatbotFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <ChatbotFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
