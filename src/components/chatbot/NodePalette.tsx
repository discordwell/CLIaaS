"use client";

import { CHATBOT_NODE_CONFIG } from "./nodes/BaseNode";
import type { ChatbotNodeType } from "@/lib/chatbot/types";

const NODE_TYPES: { type: ChatbotNodeType; description: string }[] = [
  { type: "message", description: "Send a text message" },
  { type: "buttons", description: "Show clickable options" },
  { type: "branch", description: "Route by conditions" },
  { type: "action", description: "Tag, assign, or close" },
  { type: "handoff", description: "Transfer to agent" },
  { type: "ai_response", description: "AI-generated reply" },
  { type: "article_suggest", description: "Suggest KB articles" },
  { type: "collect_input", description: "Collect validated input" },
  { type: "webhook", description: "Call external API" },
  { type: "delay", description: "Wait before continuing" },
];

export function NodePalette() {
  function onDragStart(event: React.DragEvent, type: ChatbotNodeType) {
    event.dataTransfer.setData("application/chatbot-node-type", type);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="w-48 shrink-0 border-r-2 border-zinc-950 bg-white p-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">
        Nodes
      </p>
      <div className="mt-3 space-y-1">
        {NODE_TYPES.map(({ type, description }) => {
          const cfg = CHATBOT_NODE_CONFIG[type];
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => onDragStart(e, type)}
              className="flex cursor-grab items-center gap-2 px-2 py-1.5 font-mono text-xs hover:bg-zinc-50 active:cursor-grabbing"
              title={description}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center text-[9px] font-bold text-white"
                style={{ backgroundColor: cfg.color }}
              >
                {cfg.icon}
              </span>
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase">{cfg.typeLabel}</span>
                <span className="block text-[9px] text-zinc-400">{description}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
