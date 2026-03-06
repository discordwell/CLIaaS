"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface BaseNodeProps {
  color: string;
  icon: string;
  typeLabel: string;
  label: string;
  selected?: boolean;
  hasSourceHandle?: boolean;
  hasTargetHandle?: boolean;
  hasFallbackHandle?: boolean;
  extraHandles?: React.ReactNode;
  children?: React.ReactNode;
}

export function BaseNode({
  color,
  icon,
  typeLabel,
  label,
  selected,
  hasSourceHandle = true,
  hasTargetHandle = true,
  hasFallbackHandle = false,
  extraHandles,
  children,
}: BaseNodeProps) {
  return (
    <div
      className={`min-w-[180px] max-w-[220px] border-2 bg-white shadow-sm transition-shadow ${
        selected ? "border-zinc-950 shadow-md" : "border-zinc-300"
      }`}
    >
      {hasTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-white"
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            {typeLabel}
          </p>
          <p className="truncate text-xs font-medium text-zinc-900">{label}</p>
        </div>
      </div>

      {children && <div className="border-t border-zinc-200 px-3 py-1.5">{children}</div>}

      {hasSourceHandle && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="default"
          className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-zinc-950"
        />
      )}

      {hasFallbackHandle && (
        <Handle
          type="source"
          position={Position.Right}
          id="fallback"
          className="!h-2 !w-2 !border-2 !border-red-500 !bg-red-500"
          style={{ top: "50%" }}
        />
      )}

      {extraHandles}
    </div>
  );
}

// Type configs for chatbot nodes
export const CHATBOT_NODE_CONFIG: Record<
  string,
  { color: string; icon: string; typeLabel: string }
> = {
  message: { color: "#3b82f6", icon: "M", typeLabel: "Message" },
  buttons: { color: "#6366f1", icon: "B", typeLabel: "Buttons" },
  branch: { color: "#f59e0b", icon: "?", typeLabel: "Branch" },
  action: { color: "#10b981", icon: "A", typeLabel: "Action" },
  handoff: { color: "#ef4444", icon: "H", typeLabel: "Handoff" },
  ai_response: { color: "#8b5cf6", icon: "AI", typeLabel: "AI Response" },
  article_suggest: { color: "#06b6d4", icon: "KB", typeLabel: "Article Suggest" },
  collect_input: { color: "#f97316", icon: "IN", typeLabel: "Collect Input" },
  webhook: { color: "#64748b", icon: "WH", typeLabel: "Webhook" },
  delay: { color: "#a855f7", icon: "D", typeLabel: "Delay" },
};

// Individual node components
export function MessageNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.message;
  return (
    <BaseNode {...cfg} label={data.label as string ?? "Message"} selected={selected}>
      <p className="text-[10px] text-zinc-500 line-clamp-2">{data.text as string}</p>
    </BaseNode>
  );
}

export function ButtonsNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.buttons;
  const options = (data.options as Array<{ label: string }>) ?? [];
  return (
    <BaseNode
      {...cfg}
      label={data.label as string ?? "Buttons"}
      selected={selected}
      hasSourceHandle={false}
      extraHandles={
        <>
          {options.map((_, i) => (
            <Handle
              key={`option-${i}`}
              type="source"
              position={Position.Bottom}
              id={`option-${i}`}
              className="!h-2 !w-2 !border-2 !border-indigo-500 !bg-indigo-500"
              style={{ left: `${((i + 1) / (options.length + 1)) * 100}%` }}
            />
          ))}
        </>
      }
    >
      <div className="flex flex-wrap gap-1">
        {options.map((opt, i) => (
          <span key={i} className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700">
            {opt.label}
          </span>
        ))}
      </div>
    </BaseNode>
  );
}

export function BranchNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.branch;
  const conditions = (data.conditions as Array<{ value: string }>) ?? [];
  return (
    <BaseNode
      {...cfg}
      label={data.label as string ?? `Branch on ${data.field}`}
      selected={selected}
      hasSourceHandle={false}
      hasFallbackHandle
      extraHandles={
        <>
          {conditions.map((_, i) => (
            <Handle
              key={`condition-${i}`}
              type="source"
              position={Position.Bottom}
              id={`condition-${i}`}
              className="!h-2 !w-2 !border-2 !border-amber-500 !bg-amber-500"
              style={{ left: `${((i + 1) / (conditions.length + 1)) * 100}%` }}
            />
          ))}
        </>
      }
    >
      <p className="text-[10px] text-zinc-500">{conditions.length} condition{conditions.length !== 1 ? "s" : ""}</p>
    </BaseNode>
  );
}

export function ActionNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.action;
  return (
    <BaseNode {...cfg} label={data.label as string ?? (data.actionType as string)} selected={selected}>
      <p className="text-[10px] text-zinc-500">{data.actionType as string}{data.value ? `: ${data.value}` : ""}</p>
    </BaseNode>
  );
}

export function HandoffNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.handoff;
  return (
    <BaseNode {...cfg} label="Handoff" selected={selected} hasSourceHandle={false}>
      <p className="text-[10px] text-zinc-500 line-clamp-1">{data.message as string}</p>
    </BaseNode>
  );
}

export function AiResponseNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.ai_response;
  return (
    <BaseNode {...cfg} label={data.label as string ?? "AI Response"} selected={selected} hasFallbackHandle>
      <p className="text-[10px] text-zinc-500 line-clamp-2">{data.systemPrompt as string}</p>
    </BaseNode>
  );
}

export function ArticleSuggestNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.article_suggest;
  return (
    <BaseNode {...cfg} label={data.label as string ?? "Article Suggest"} selected={selected} hasFallbackHandle>
      <p className="text-[10px] text-zinc-500">Max {(data.maxArticles as number) ?? 3} articles</p>
    </BaseNode>
  );
}

export function CollectInputNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.collect_input;
  return (
    <BaseNode {...cfg} label={data.label as string ?? `Collect: ${data.variable}`} selected={selected}>
      <p className="text-[10px] text-zinc-500">{data.validation as string ?? "any"} input</p>
    </BaseNode>
  );
}

export function WebhookNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.webhook;
  return (
    <BaseNode {...cfg} label={data.label as string ?? "Webhook"} selected={selected} hasFallbackHandle>
      <p className="text-[10px] text-zinc-500 truncate">{data.method as string} {data.url as string}</p>
    </BaseNode>
  );
}

export function DelayNode({ data, selected }: NodeProps) {
  const cfg = CHATBOT_NODE_CONFIG.delay;
  return (
    <BaseNode {...cfg} label={data.label as string ?? `Delay ${data.seconds}s`} selected={selected}>
      <p className="text-[10px] text-zinc-500">{data.seconds as number} seconds</p>
    </BaseNode>
  );
}

export const chatbotNodeTypes = {
  chatbot_message: MessageNode,
  chatbot_buttons: ButtonsNode,
  chatbot_branch: BranchNode,
  chatbot_action: ActionNode,
  chatbot_handoff: HandoffNode,
  chatbot_ai_response: AiResponseNode,
  chatbot_article_suggest: ArticleSuggestNode,
  chatbot_collect_input: CollectInputNode,
  chatbot_webhook: WebhookNode,
  chatbot_delay: DelayNode,
};
