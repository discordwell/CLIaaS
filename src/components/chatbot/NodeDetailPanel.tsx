"use client";

import type { Node } from "@xyflow/react";
import type { ChatbotNodeType } from "@/lib/chatbot/types";
import { CHATBOT_NODE_CONFIG } from "./nodes/BaseNode";

interface NodeDetailPanelProps {
  node: Node | null;
  allNodes: Node[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}

export function NodeDetailPanel({ node, allNodes, onUpdate, onClose }: NodeDetailPanelProps) {
  if (!node) {
    return (
      <div className="w-72 shrink-0 border-l-2 border-zinc-950 bg-white p-4">
        <p className="text-center font-mono text-xs text-zinc-400">Select a node to edit</p>
      </div>
    );
  }

  const nodeType = (node.data.nodeType ?? node.type?.replace("chatbot_", "")) as ChatbotNodeType;
  const cfg = CHATBOT_NODE_CONFIG[nodeType] ?? { color: "#666", icon: "?", typeLabel: "Unknown" };

  function update(patch: Record<string, unknown>) {
    onUpdate(node!.id, { ...node!.data, ...patch });
  }

  const nodeOptions = allNodes
    .filter((n) => n.id !== node.id)
    .map((n) => ({
      id: n.id,
      label: `${(n.data.nodeType as string) ?? "node"}: ${n.id.slice(0, 8)}`,
    }));

  return (
    <div className="w-72 shrink-0 overflow-y-auto border-l-2 border-zinc-950 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b-2 border-zinc-950 px-4 py-3">
        <span
          className="flex h-6 w-6 items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: cfg.color }}
        >
          {cfg.icon}
        </span>
        <span className="flex-1 font-mono text-xs font-bold uppercase">{cfg.typeLabel}</span>
        <button onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-950">
          &times;
        </button>
      </div>

      <div className="space-y-4 p-4">
        {nodeType === "message" && (
          <>
            <Field label="Message Text">
              <textarea
                value={(node.data.text as string) ?? ""}
                onChange={(e) => update({ text: e.target.value })}
                rows={4}
                className="w-full border-2 border-zinc-300 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
              />
            </Field>
          </>
        )}

        {nodeType === "buttons" && (
          <>
            <Field label="Prompt Text">
              <textarea
                value={(node.data.text as string) ?? ""}
                onChange={(e) => update({ text: e.target.value })}
                rows={2}
                className="w-full border-2 border-zinc-300 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
              />
            </Field>
            <Field label="Options">
              {((node.data.options as Array<{ label: string; nextNodeId: string }>) ?? []).map(
                (opt, i) => (
                  <div key={i} className="mb-1 flex items-center gap-1">
                    <input
                      value={opt.label}
                      onChange={(e) => {
                        const opts = [
                          ...((node.data.options as Array<{ label: string; nextNodeId: string }>) ?? []),
                        ];
                        opts[i] = { ...opts[i], label: e.target.value };
                        update({ options: opts });
                      }}
                      className="flex-1 border-2 border-zinc-300 px-2 py-1 text-[10px] focus:outline-none"
                      placeholder="Label"
                    />
                    <button
                      onClick={() => {
                        const opts = ((node.data.options as Array<{ label: string; nextNodeId: string }>) ?? []).filter((_, j) => j !== i);
                        update({ options: opts });
                      }}
                      className="text-[10px] text-red-400 hover:text-red-600"
                    >
                      &times;
                    </button>
                  </div>
                ),
              )}
              <button
                onClick={() => {
                  const opts = [
                    ...((node.data.options as Array<{ label: string; nextNodeId: string }>) ?? []),
                    { label: "New option", nextNodeId: "" },
                  ];
                  update({ options: opts });
                }}
                className="font-mono text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
              >
                + Add Option
              </button>
            </Field>
          </>
        )}

        {nodeType === "branch" && (
          <>
            <Field label="Branch On">
              <select
                value={(node.data.field as string) ?? "message"}
                onChange={(e) => update({ field: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              >
                <option value="message">Customer Message</option>
                <option value="email">Email</option>
                <option value="name">Name</option>
              </select>
            </Field>
            <Field label="Conditions">
              {((node.data.conditions as Array<{ op: string; value: string; nextNodeId: string }>) ?? []).map(
                (cond, i) => (
                  <div key={i} className="mb-1 flex items-center gap-1">
                    <select
                      value={cond.op}
                      onChange={(e) => {
                        const conds = [
                          ...((node.data.conditions as Array<{ op: string; value: string; nextNodeId: string }>) ?? []),
                        ];
                        conds[i] = { ...conds[i], op: e.target.value };
                        update({ conditions: conds });
                      }}
                      className="border-2 border-zinc-300 px-1 py-0.5 text-[10px] focus:outline-none"
                    >
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="starts_with">starts with</option>
                      <option value="ends_with">ends with</option>
                      <option value="matches">matches</option>
                    </select>
                    <input
                      value={cond.value}
                      onChange={(e) => {
                        const conds = [
                          ...((node.data.conditions as Array<{ op: string; value: string; nextNodeId: string }>) ?? []),
                        ];
                        conds[i] = { ...conds[i], value: e.target.value };
                        update({ conditions: conds });
                      }}
                      className="flex-1 border-2 border-zinc-300 px-1 py-0.5 text-[10px] focus:outline-none"
                      placeholder="Value"
                    />
                    <button
                      onClick={() => {
                        const conds = ((node.data.conditions as Array<{ op: string; value: string; nextNodeId: string }>) ?? []).filter((_, j) => j !== i);
                        update({ conditions: conds });
                      }}
                      className="text-[10px] text-red-400"
                    >
                      &times;
                    </button>
                  </div>
                ),
              )}
              <button
                onClick={() => {
                  const conds = [
                    ...((node.data.conditions as Array<{ op: string; value: string; nextNodeId: string }>) ?? []),
                    { op: "contains", value: "", nextNodeId: "" },
                  ];
                  update({ conditions: conds });
                }}
                className="font-mono text-[10px] font-bold text-amber-600"
              >
                + Add Condition
              </button>
            </Field>
          </>
        )}

        {nodeType === "action" && (
          <>
            <Field label="Action Type">
              <select
                value={(node.data.actionType as string) ?? "set_tag"}
                onChange={(e) => update({ actionType: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              >
                <option value="set_tag">Set Tag</option>
                <option value="create_ticket">Create Ticket</option>
                <option value="assign">Assign</option>
                <option value="close">Close</option>
              </select>
            </Field>
            {((node.data.actionType as string) === "set_tag" || (node.data.actionType as string) === "assign") && (
              <Field label="Value">
                <input
                  value={(node.data.value as string) ?? ""}
                  onChange={(e) => update({ value: e.target.value })}
                  className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
                />
              </Field>
            )}
          </>
        )}

        {nodeType === "handoff" && (
          <Field label="Handoff Message">
            <textarea
              value={(node.data.message as string) ?? ""}
              onChange={(e) => update({ message: e.target.value })}
              rows={3}
              className="w-full border-2 border-zinc-300 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
            />
          </Field>
        )}

        {nodeType === "ai_response" && (
          <>
            <Field label="System Prompt">
              <textarea
                value={(node.data.systemPrompt as string) ?? ""}
                onChange={(e) => update({ systemPrompt: e.target.value })}
                rows={4}
                className="w-full border-2 border-zinc-300 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
              />
            </Field>
            <Field label="Max Tokens">
              <input
                type="number"
                value={(node.data.maxTokens as number) ?? 300}
                onChange={(e) => update({ maxTokens: parseInt(e.target.value) || 300 })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              />
            </Field>
            <Field label="Fallback Node">
              <NodeSelect value={(node.data.fallbackNodeId as string) ?? ""} options={nodeOptions} onChange={(v) => update({ fallbackNodeId: v || undefined })} />
            </Field>
          </>
        )}

        {nodeType === "article_suggest" && (
          <>
            <Field label="Search Query (blank = use message)">
              <input
                value={(node.data.query as string) ?? ""}
                onChange={(e) => update({ query: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
                placeholder="Optional"
              />
            </Field>
            <Field label="Max Articles">
              <input
                type="number"
                value={(node.data.maxArticles as number) ?? 3}
                onChange={(e) => update({ maxArticles: parseInt(e.target.value) || 3 })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              />
            </Field>
            <Field label="No Results Node">
              <NodeSelect value={(node.data.noResultsNodeId as string) ?? ""} options={nodeOptions} onChange={(v) => update({ noResultsNodeId: v || undefined })} />
            </Field>
          </>
        )}

        {nodeType === "collect_input" && (
          <>
            <Field label="Prompt">
              <textarea
                value={(node.data.prompt as string) ?? ""}
                onChange={(e) => update({ prompt: e.target.value })}
                rows={2}
                className="w-full border-2 border-zinc-300 px-3 py-2 text-xs focus:border-zinc-950 focus:outline-none"
              />
            </Field>
            <Field label="Variable Name">
              <input
                value={(node.data.variable as string) ?? ""}
                onChange={(e) => update({ variable: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
                placeholder="e.g. email, name, phone"
              />
            </Field>
            <Field label="Validation">
              <select
                value={(node.data.validation as string) ?? "none"}
                onChange={(e) => update({ validation: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              >
                <option value="none">None</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="number">Number</option>
              </select>
            </Field>
            <Field label="Error Message">
              <input
                value={(node.data.errorMessage as string) ?? ""}
                onChange={(e) => update({ errorMessage: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
                placeholder="Please enter a valid..."
              />
            </Field>
          </>
        )}

        {nodeType === "webhook" && (
          <>
            <Field label="URL">
              <input
                value={(node.data.url as string) ?? ""}
                onChange={(e) => update({ url: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
                placeholder="https://..."
              />
            </Field>
            <Field label="Method">
              <select
                value={(node.data.method as string) ?? "POST"}
                onChange={(e) => update({ method: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </Field>
            <Field label="Body Template">
              <textarea
                value={(node.data.bodyTemplate as string) ?? ""}
                onChange={(e) => update({ bodyTemplate: e.target.value })}
                rows={3}
                className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-[10px] focus:border-zinc-950 focus:outline-none"
                placeholder='{"email":"{{email}}"}'
              />
            </Field>
            <Field label="Response Variable">
              <input
                value={(node.data.responseVariable as string) ?? ""}
                onChange={(e) => update({ responseVariable: e.target.value })}
                className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
              />
            </Field>
            <Field label="Failure Node">
              <NodeSelect value={(node.data.failureNodeId as string) ?? ""} options={nodeOptions} onChange={(v) => update({ failureNodeId: v || undefined })} />
            </Field>
          </>
        )}

        {nodeType === "delay" && (
          <Field label="Delay (seconds)">
            <input
              type="number"
              value={(node.data.seconds as number) ?? 3}
              onChange={(e) => update({ seconds: parseInt(e.target.value) || 3 })}
              className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] font-bold uppercase text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function NodeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border-2 border-zinc-300 px-2 py-1 text-xs focus:outline-none"
    >
      <option value="">None</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
