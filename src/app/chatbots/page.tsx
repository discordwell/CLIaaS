"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Types (mirror server types) ----

type ChatbotNodeType = "message" | "buttons" | "branch" | "action" | "handoff";

interface ButtonOption {
  label: string;
  nextNodeId: string;
}

interface BranchCondition {
  op: string;
  value: string;
  nextNodeId: string;
}

interface ChatbotNode {
  id: string;
  type: ChatbotNodeType;
  data: Record<string, unknown>;
  children?: string[];
}

interface ChatbotFlow {
  id: string;
  name: string;
  nodes: Record<string, ChatbotNode>;
  rootNodeId: string;
  enabled: boolean;
  greeting?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Node type config ----

const nodeTypeConfig: Record<
  ChatbotNodeType,
  { label: string; color: string; icon: string }
> = {
  message: { label: "Message", color: "bg-blue-500", icon: "M" },
  buttons: { label: "Buttons", color: "bg-indigo-500", icon: "B" },
  branch: { label: "Branch", color: "bg-amber-500", icon: "?" },
  action: { label: "Action", color: "bg-emerald-500", icon: "A" },
  handoff: { label: "Handoff", color: "bg-red-500", icon: "H" },
};

// ---- Component ----

export default function ChatbotsPage() {
  const [chatbots, setChatbots] = useState<ChatbotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFlow, setEditingFlow] = useState<ChatbotFlow | null>(null);
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

  // ---- Render: Builder view ----

  if (editingFlow) {
    return (
      <FlowBuilder
        flow={editingFlow}
        onSave={async (updated) => {
          await fetch(`/api/chatbots/${updated.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
          });
          setEditingFlow(null);
          loadChatbots();
        }}
        onCancel={() => setEditingFlow(null)}
      />
    );
  }

  // ---- Render: New flow form ----

  if (showNewForm) {
    return (
      <NewFlowForm
        onCreated={(flow) => {
          setShowNewForm(false);
          setEditingFlow(flow);
          loadChatbots();
        }}
        onCancel={() => setShowNewForm(false)}
      />
    );
  }

  // ---- Render: List view ----

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
              <div
                key={flow.id}
                className="flex items-center justify-between p-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        flow.enabled ? "bg-emerald-500" : "bg-zinc-300"
                      }`}
                    />
                    <p className="truncate text-sm font-bold">{flow.name}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {Object.keys(flow.nodes).length} nodes · Created{" "}
                    {new Date(flow.createdAt).toLocaleDateString()}
                  </p>
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
                    onClick={() => setEditingFlow(flow)}
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

// ---- New Flow Form ----

function NewFlowForm({
  onCreated,
  onCancel,
}: {
  onCreated: (flow: ChatbotFlow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("Hi! How can I help you today?");
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

    // Create a simple starter flow: greeting message → buttons
    const rootId = crypto.randomUUID();
    const btnId = crypto.randomUUID();
    const msgSalesId = crypto.randomUUID();
    const msgSupportId = crypto.randomUUID();
    const handoffId = crypto.randomUUID();

    const nodes: Record<string, ChatbotNode> = {
      [rootId]: {
        id: rootId,
        type: "message",
        data: { text: greeting },
        children: [btnId],
      },
      [btnId]: {
        id: btnId,
        type: "buttons",
        data: {
          text: "What can I help you with?",
          options: [
            { label: "Sales", nextNodeId: msgSalesId },
            { label: "Support", nextNodeId: msgSupportId },
          ],
        },
      },
      [msgSalesId]: {
        id: msgSalesId,
        type: "message",
        data: { text: "I'll connect you with our sales team." },
        children: [handoffId],
      },
      [msgSupportId]: {
        id: msgSupportId,
        type: "message",
        data: {
          text: "I'll connect you with a support agent who can help.",
        },
        children: [handoffId],
      },
      [handoffId]: {
        id: handoffId,
        type: "handoff",
        data: { message: "Connecting you to an agent now..." },
      },
    };

    try {
      const res = await fetch("/api/chatbots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nodes,
          rootNodeId: rootId,
          greeting,
        }),
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
    <main className="mx-auto max-w-2xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          New Chatbot Flow
        </p>
        <h1 className="mt-2 text-2xl font-bold">Create a Chatbot</h1>
      </header>

      <form
        onSubmit={handleCreate}
        className="mt-8 border-2 border-zinc-950 bg-white p-8"
      >
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
            Greeting Message
          </label>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            className="mt-2 w-full border-2 border-zinc-300 px-4 py-2 text-sm focus:border-zinc-950 focus:outline-none"
          />
        </div>

        {error && (
          <p className="mt-4 font-mono text-xs font-bold text-red-600">
            {error}
          </p>
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

// ---- Flow Builder ----

function FlowBuilder({
  flow,
  onSave,
  onCancel,
}: {
  flow: ChatbotFlow;
  onSave: (flow: ChatbotFlow) => Promise<void>;
  onCancel: () => void;
}) {
  const [nodes, setNodes] = useState<Record<string, ChatbotNode>>(flow.nodes);
  const [rootNodeId] = useState(flow.rootNodeId);
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ---- Preview state ----
  const [previewMessages, setPreviewMessages] = useState<
    { role: "bot" | "customer"; body: string; buttons?: ButtonOption[] }[]
  >([]);
  const [previewState, setPreviewState] = useState<{
    currentNodeId: string;
    visitedNodes: string[];
  } | null>(null);

  function startPreview() {
    setPreviewMessages([]);
    setPreviewState({ currentNodeId: rootNodeId, visitedNodes: [] });
    // Process from root
    processPreviewNode(rootNodeId, { currentNodeId: rootNodeId, visitedNodes: [] });
  }

  function processPreviewNode(
    nodeId: string,
    state: { currentNodeId: string; visitedNodes: string[] },
  ) {
    const node = nodes[nodeId];
    if (!node) return;

    const visited = [...state.visitedNodes, nodeId];

    switch (node.type) {
      case "message": {
        const text = (node.data as { text: string }).text;
        setPreviewMessages((prev) => [...prev, { role: "bot", body: text }]);
        const next = node.children?.[0];
        if (next) {
          setTimeout(() => processPreviewNode(next, { currentNodeId: next, visitedNodes: visited }), 500);
        }
        setPreviewState({ currentNodeId: next ?? "", visitedNodes: visited });
        break;
      }
      case "buttons": {
        const data = node.data as { text: string; options: ButtonOption[] };
        setPreviewMessages((prev) => [
          ...prev,
          { role: "bot", body: data.text, buttons: data.options },
        ]);
        setPreviewState({ currentNodeId: nodeId, visitedNodes: visited });
        break;
      }
      case "handoff": {
        const text = (node.data as { message: string }).message;
        setPreviewMessages((prev) => [...prev, { role: "bot", body: text }]);
        setPreviewState(null);
        break;
      }
      case "action": {
        const next = node.children?.[0];
        if (next) {
          processPreviewNode(next, { currentNodeId: next, visitedNodes: visited });
        }
        break;
      }
      default:
        break;
    }
  }

  function handlePreviewButton(label: string, nextNodeId: string) {
    setPreviewMessages((prev) => [...prev, { role: "customer", body: label }]);
    if (previewState) {
      setTimeout(() => processPreviewNode(nextNodeId, {
        currentNodeId: nextNodeId,
        visitedNodes: [...previewState.visitedNodes, nextNodeId],
      }), 300);
    }
  }

  async function handleSave() {
    setSaving(true);
    await onSave({ ...flow, nodes, rootNodeId, updatedAt: new Date().toISOString() });
    setSaving(false);
  }

  function addNode(type: ChatbotNodeType, parentId?: string) {
    const id = crypto.randomUUID();
    let data: Record<string, unknown> = {};

    switch (type) {
      case "message":
        data = { text: "New message" };
        break;
      case "buttons":
        data = { text: "Choose an option:", options: [] };
        break;
      case "branch":
        data = { field: "message", conditions: [] };
        break;
      case "action":
        data = { actionType: "set_tag", value: "" };
        break;
      case "handoff":
        data = { message: "Connecting you to an agent..." };
        break;
    }

    const newNode: ChatbotNode = { id, type, data };
    const updated = { ...nodes, [id]: newNode };

    // Attach to parent if specified
    if (parentId && updated[parentId]) {
      const parent = { ...updated[parentId] };
      parent.children = [...(parent.children ?? []), id];
      updated[parentId] = parent;
    }

    setNodes(updated);
    setSelectedNodeId(id);
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>) {
    setNodes((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], data },
    }));
  }

  function removeNode(nodeId: string) {
    const updated = { ...nodes };
    delete updated[nodeId];

    // Remove references from parent children arrays
    for (const [nid, node] of Object.entries(updated)) {
      if (node.children?.includes(nodeId)) {
        updated[nid] = {
          ...node,
          children: node.children.filter((c) => c !== nodeId),
        };
      }
    }

    // Remove references from button options
    for (const [nid, node] of Object.entries(updated)) {
      if (node.type === "buttons") {
        const data = node.data as { text: string; options: ButtonOption[] };
        const filtered = data.options.filter((o) => o.nextNodeId !== nodeId);
        if (filtered.length !== data.options.length) {
          updated[nid] = { ...node, data: { ...data, options: filtered } };
        }
      }
    }

    setNodes(updated);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Flow Builder
            </p>
            <h1 className="mt-1 text-xl font-bold">{flow.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={startPreview}
              className="border-2 border-indigo-500 px-4 py-1.5 font-mono text-xs font-bold uppercase text-indigo-600 hover:bg-indigo-50"
            >
              Preview
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-1.5 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
            >
              Back
            </button>
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Left: Node palette + tree */}
        <div className="lg:col-span-2">
          {/* Node palette */}
          <div className="border-2 border-zinc-950 bg-white p-4">
            <p className="mb-3 font-mono text-xs font-bold uppercase text-zinc-500">
              Add Node
            </p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(nodeTypeConfig) as ChatbotNodeType[]).map(
                (type) => (
                  <button
                    key={type}
                    onClick={() => addNode(type)}
                    className="flex items-center gap-2 border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-700 transition-colors hover:border-zinc-950"
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center text-[10px] text-white ${nodeTypeConfig[type].color}`}
                    >
                      {nodeTypeConfig[type].icon}
                    </span>
                    {nodeTypeConfig[type].label}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Flow tree */}
          <div className="mt-4 border-2 border-zinc-950 bg-white p-4">
            <p className="mb-3 font-mono text-xs font-bold uppercase text-zinc-500">
              Flow Tree
            </p>
            {rootNodeId && nodes[rootNodeId] ? (
              <NodeTree
                nodes={nodes}
                nodeId={rootNodeId}
                depth={0}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
                onAddChild={(parentId, type) => addNode(type, parentId)}
                onRemove={removeNode}
              />
            ) : (
              <p className="text-sm text-zinc-500">
                No root node. Add a Message node to start.
              </p>
            )}
          </div>
        </div>

        {/* Right: Node editor + Preview */}
        <div className="space-y-8">
          {/* Node editor */}
          {selectedNode ? (
            <NodeEditor
              node={selectedNode}
              allNodes={nodes}
              onUpdate={(data) => updateNodeData(selectedNode.id, data)}
            />
          ) : (
            <div className="border-2 border-zinc-200 bg-white p-6 text-center">
              <p className="font-mono text-xs text-zinc-500">
                Select a node to edit
              </p>
            </div>
          )}

          {/* Preview */}
          {previewMessages.length > 0 && (
            <div className="border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-white">
                <p className="font-mono text-xs font-bold uppercase">
                  Preview
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto p-4">
                {previewMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`mb-3 flex flex-col ${
                      msg.role === "customer" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="mb-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
                      {msg.role === "customer" ? "You" : "Bot"}
                    </div>
                    <div
                      className={`max-w-[85%] border-2 px-3 py-2 text-sm ${
                        msg.role === "customer"
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-indigo-300 bg-indigo-50"
                      }`}
                    >
                      {msg.body}
                    </div>
                    {msg.buttons && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.buttons.map((btn) => (
                          <button
                            key={btn.label}
                            onClick={() =>
                              handlePreviewButton(btn.label, btn.nextNodeId)
                            }
                            className="border-2 border-indigo-400 bg-white px-3 py-1 font-mono text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---- Node Tree (recursive) ----

function NodeTree({
  nodes,
  nodeId,
  depth,
  selectedId,
  onSelect,
  onAddChild,
  onRemove,
}: {
  nodes: Record<string, ChatbotNode>;
  nodeId: string;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string, type: ChatbotNodeType) => void;
  onRemove: (id: string) => void;
}) {
  const node = nodes[nodeId];
  if (!node) return null;

  const config = nodeTypeConfig[node.type];
  const isSelected = selectedId === nodeId;

  // Collect children: from children array + button option targets
  const childIds = new Set<string>(node.children ?? []);
  if (node.type === "buttons") {
    const opts = (node.data as { options: ButtonOption[] }).options ?? [];
    for (const opt of opts) {
      if (opt.nextNodeId && nodes[opt.nextNodeId]) {
        childIds.add(opt.nextNodeId);
      }
    }
  }
  if (node.type === "branch") {
    const conds =
      (node.data as { conditions: BranchCondition[] }).conditions ?? [];
    for (const c of conds) {
      if (c.nextNodeId && nodes[c.nextNodeId]) {
        childIds.add(c.nextNodeId);
      }
    }
    const fallback = (node.data as { fallbackNodeId?: string }).fallbackNodeId;
    if (fallback && nodes[fallback]) childIds.add(fallback);
  }

  // Preview text for the node
  let preview = "";
  switch (node.type) {
    case "message":
      preview = ((node.data as { text: string }).text ?? "").slice(0, 40);
      break;
    case "buttons":
      preview = ((node.data as { text: string }).text ?? "").slice(0, 30);
      break;
    case "branch":
      preview = `on ${(node.data as { field: string }).field}`;
      break;
    case "action":
      preview = (node.data as { actionType: string }).actionType;
      break;
    case "handoff":
      preview = "→ agent";
      break;
  }

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div
        onClick={() => onSelect(nodeId)}
        className={`mb-1 flex cursor-pointer items-center gap-2 border-2 px-3 py-2 transition-colors ${
          isSelected
            ? "border-zinc-950 bg-zinc-50"
            : "border-zinc-200 hover:border-zinc-400"
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center text-[10px] font-bold text-white ${config.color}`}
        >
          {config.icon}
        </span>
        <span className="flex-1 truncate text-xs font-medium">
          <span className="font-bold">{config.label}</span>
          {preview && (
            <span className="ml-2 text-zinc-500">{preview}</span>
          )}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddChild(nodeId, "message");
          }}
          className="shrink-0 font-mono text-xs text-zinc-400 hover:text-zinc-950"
          title="Add child node"
        >
          +
        </button>
        {depth > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(nodeId);
            }}
            className="shrink-0 font-mono text-xs text-red-400 hover:text-red-600"
            title="Remove node"
          >
            ×
          </button>
        )}
      </div>

      {/* Render children */}
      {Array.from(childIds).map((childId) => (
        <NodeTree
          key={childId}
          nodes={nodes}
          nodeId={childId}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

// ---- Node Editor ----

function NodeEditor({
  node,
  allNodes,
  onUpdate,
}: {
  node: ChatbotNode;
  allNodes: Record<string, ChatbotNode>;
  onUpdate: (data: Record<string, unknown>) => void;
}) {
  const config = nodeTypeConfig[node.type];

  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="flex items-center gap-2 border-b-2 border-zinc-950 p-4">
        <span
          className={`flex h-6 w-6 items-center justify-center text-[10px] font-bold text-white ${config.color}`}
        >
          {config.icon}
        </span>
        <span className="font-mono text-xs font-bold uppercase">
          {config.label} Node
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-400">
          {node.id.slice(0, 8)}
        </span>
      </div>

      <div className="p-4">
        {node.type === "message" && (
          <MessageEditor
            data={node.data as { text: string }}
            onUpdate={onUpdate}
          />
        )}
        {node.type === "buttons" && (
          <ButtonsEditor
            data={node.data as { text: string; options: ButtonOption[] }}
            allNodes={allNodes}
            onUpdate={onUpdate}
          />
        )}
        {node.type === "branch" && (
          <BranchEditor
            data={
              node.data as {
                field: string;
                conditions: BranchCondition[];
                fallbackNodeId?: string;
              }
            }
            allNodes={allNodes}
            onUpdate={onUpdate}
          />
        )}
        {node.type === "action" && (
          <ActionEditor
            data={node.data as { actionType: string; value?: string }}
            onUpdate={onUpdate}
          />
        )}
        {node.type === "handoff" && (
          <HandoffEditor
            data={node.data as { message: string }}
            onUpdate={onUpdate}
          />
        )}
      </div>
    </div>
  );
}

// ---- Individual node type editors ----

function MessageEditor({
  data,
  onUpdate,
}: {
  data: { text: string };
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
        Message Text
      </label>
      <textarea
        value={data.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
        rows={3}
        className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
      />
    </div>
  );
}

function ButtonsEditor({
  data,
  allNodes,
  onUpdate,
}: {
  data: { text: string; options: ButtonOption[] };
  allNodes: Record<string, ChatbotNode>;
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  function addOption() {
    onUpdate({
      ...data,
      options: [...data.options, { label: "New option", nextNodeId: "" }],
    });
  }

  function updateOption(idx: number, field: string, value: string) {
    const updated = [...data.options];
    updated[idx] = { ...updated[idx], [field]: value };
    onUpdate({ ...data, options: updated });
  }

  function removeOption(idx: number) {
    onUpdate({ ...data, options: data.options.filter((_, i) => i !== idx) });
  }

  const nodeOptions = Object.entries(allNodes).map(([id, n]) => ({
    id,
    label: `${nodeTypeConfig[n.type]?.label ?? n.type}: ${id.slice(0, 8)}`,
  }));

  return (
    <div>
      <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
        Prompt Text
      </label>
      <textarea
        value={data.text}
        onChange={(e) => onUpdate({ ...data, text: e.target.value })}
        rows={2}
        className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
      />

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="font-mono text-xs font-bold uppercase text-zinc-500">
            Options
          </label>
          <button
            onClick={addOption}
            className="font-mono text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            + Add
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {data.options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={opt.label}
                onChange={(e) => updateOption(idx, "label", e.target.value)}
                placeholder="Button label"
                className="flex-1 border-2 border-zinc-300 px-2 py-1 text-xs focus:border-zinc-950 focus:outline-none"
              />
              <select
                value={opt.nextNodeId}
                onChange={(e) =>
                  updateOption(idx, "nextNodeId", e.target.value)
                }
                className="border-2 border-zinc-300 px-2 py-1 text-xs focus:border-zinc-950 focus:outline-none"
              >
                <option value="">→ None</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeOption(idx)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BranchEditor({
  data,
  allNodes,
  onUpdate,
}: {
  data: {
    field: string;
    conditions: BranchCondition[];
    fallbackNodeId?: string;
  };
  allNodes: Record<string, ChatbotNode>;
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  const nodeOptions = Object.entries(allNodes).map(([id, n]) => ({
    id,
    label: `${nodeTypeConfig[n.type]?.label ?? n.type}: ${id.slice(0, 8)}`,
  }));

  function addCondition() {
    onUpdate({
      ...data,
      conditions: [
        ...data.conditions,
        { op: "contains", value: "", nextNodeId: "" },
      ],
    });
  }

  function updateCondition(
    idx: number,
    field: string,
    value: string,
  ) {
    const updated = [...data.conditions];
    updated[idx] = { ...updated[idx], [field]: value };
    onUpdate({ ...data, conditions: updated });
  }

  function removeCondition(idx: number) {
    onUpdate({
      ...data,
      conditions: data.conditions.filter((_, i) => i !== idx),
    });
  }

  return (
    <div>
      <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
        Branch On
      </label>
      <select
        value={data.field}
        onChange={(e) => onUpdate({ ...data, field: e.target.value })}
        className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
      >
        <option value="message">Customer Message</option>
        <option value="email">Email</option>
        <option value="name">Name</option>
      </select>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="font-mono text-xs font-bold uppercase text-zinc-500">
            Conditions
          </label>
          <button
            onClick={addCondition}
            className="font-mono text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            + Add
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {data.conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <select
                value={cond.op}
                onChange={(e) => updateCondition(idx, "op", e.target.value)}
                className="border-2 border-zinc-300 px-1 py-1 text-xs focus:outline-none"
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
                <option value="matches">matches</option>
              </select>
              <input
                value={cond.value}
                onChange={(e) => updateCondition(idx, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              />
              <select
                value={cond.nextNodeId}
                onChange={(e) =>
                  updateCondition(idx, "nextNodeId", e.target.value)
                }
                className="border-2 border-zinc-300 px-1 py-1 text-xs focus:outline-none"
              >
                <option value="">→ None</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeCondition(idx)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
          Fallback (no match)
        </label>
        <select
          value={data.fallbackNodeId ?? ""}
          onChange={(e) =>
            onUpdate({ ...data, fallbackNodeId: e.target.value || undefined })
          }
          className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">None</option>
          {nodeOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ActionEditor({
  data,
  onUpdate,
}: {
  data: { actionType: string; value?: string };
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
        Action Type
      </label>
      <select
        value={data.actionType}
        onChange={(e) => onUpdate({ ...data, actionType: e.target.value })}
        className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
      >
        <option value="set_tag">Set Tag</option>
        <option value="create_ticket">Create Ticket</option>
        <option value="assign">Assign to Agent</option>
        <option value="close">Close Chat</option>
      </select>

      {(data.actionType === "set_tag" || data.actionType === "assign") && (
        <div className="mt-4">
          <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
            Value
          </label>
          <input
            value={data.value ?? ""}
            onChange={(e) => onUpdate({ ...data, value: e.target.value })}
            placeholder={
              data.actionType === "set_tag" ? "Tag name" : "Agent email"
            }
            className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

function HandoffEditor({
  data,
  onUpdate,
}: {
  data: { message: string };
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
        Handoff Message
      </label>
      <textarea
        value={data.message}
        onChange={(e) => onUpdate({ message: e.target.value })}
        rows={3}
        className="mt-2 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
      />
      <p className="mt-2 font-mono text-[10px] text-zinc-500">
        This message is shown when the bot transfers the conversation to a human
        agent.
      </p>
    </div>
  );
}
