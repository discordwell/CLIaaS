/**
 * Serialization between chatbot flow (inline refs) and React Flow (nodes + edges).
 *
 * Chatbot flows store connections inline:
 * - children[] for message/action/collect_input/delay
 * - options[].nextNodeId for buttons
 * - conditions[].nextNodeId for branch
 * - fallbackNodeId for branch/ai_response/article_suggest/webhook
 *
 * React Flow uses a separate edges array. These functions convert between formats.
 */

import type { Node, Edge } from "@xyflow/react";
import type { ChatbotFlow, ChatbotNode, ChatbotNodeType } from "@/lib/chatbot/types";
import { getLayoutedElements } from "@/components/flow-canvas/dagre-layout";

const NODE_TYPE_COLORS: Record<ChatbotNodeType, string> = {
  message: "#3b82f6",
  buttons: "#6366f1",
  branch: "#f59e0b",
  action: "#10b981",
  handoff: "#ef4444",
  ai_response: "#8b5cf6",
  article_suggest: "#06b6d4",
  collect_input: "#f97316",
  webhook: "#64748b",
  delay: "#a855f7",
};

export function flowToReactFlow(flow: ChatbotFlow): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];

  for (const node of Object.values(flow.nodes)) {
    rfNodes.push({
      id: node.id,
      type: `chatbot_${node.type}`,
      position: node.position ?? { x: 0, y: 0 },
      data: {
        ...node.data,
        nodeType: node.type,
        label: getNodeLabel(node),
      },
    });

    // Extract edges from inline refs
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        rfEdges.push({
          id: `${node.id}-child-${i}`,
          source: node.id,
          target: node.children[i],
          sourceHandle: "default",
          type: "smoothstep",
          style: { stroke: NODE_TYPE_COLORS[node.type] || "#09090b" },
        });
      }
    }

    if (node.type === "buttons") {
      const data = node.data as { options?: Array<{ label: string; nextNodeId: string }> };
      for (let i = 0; i < (data.options?.length ?? 0); i++) {
        const opt = data.options![i];
        if (opt.nextNodeId) {
          rfEdges.push({
            id: `${node.id}-opt-${i}`,
            source: node.id,
            target: opt.nextNodeId,
            sourceHandle: `option-${i}`,
            label: opt.label,
            type: "smoothstep",
            style: { stroke: NODE_TYPE_COLORS.buttons },
          });
        }
      }
    }

    if (node.type === "branch") {
      const data = node.data as {
        conditions?: Array<{ value: string; nextNodeId: string }>;
        fallbackNodeId?: string;
      };
      for (let i = 0; i < (data.conditions?.length ?? 0); i++) {
        const cond = data.conditions![i];
        if (cond.nextNodeId) {
          rfEdges.push({
            id: `${node.id}-cond-${i}`,
            source: node.id,
            target: cond.nextNodeId,
            sourceHandle: `condition-${i}`,
            label: cond.value,
            type: "smoothstep",
            style: { stroke: NODE_TYPE_COLORS.branch },
          });
        }
      }
      if (data.fallbackNodeId) {
        rfEdges.push({
          id: `${node.id}-fallback`,
          source: node.id,
          target: data.fallbackNodeId,
          sourceHandle: "fallback",
          label: "else",
          type: "smoothstep",
          style: { stroke: "#dc2626" },
        });
      }
    }

    // Fallback edges for ai_response, article_suggest, webhook
    const fallbackNodeId =
      (node.data as Record<string, unknown>).fallbackNodeId ??
      (node.data as Record<string, unknown>).noResultsNodeId ??
      (node.data as Record<string, unknown>).failureNodeId;
    if (
      fallbackNodeId &&
      typeof fallbackNodeId === "string" &&
      !["branch"].includes(node.type)
    ) {
      rfEdges.push({
        id: `${node.id}-fallback`,
        source: node.id,
        target: fallbackNodeId,
        sourceHandle: "fallback",
        label: "fallback",
        type: "smoothstep",
        style: { stroke: "#dc2626", strokeDasharray: "5 3" },
      });
    }
  }

  // Auto-layout if no positions
  const hasPositions = rfNodes.some((n) => n.position.x !== 0 || n.position.y !== 0);
  if (!hasPositions && rfNodes.length > 0) {
    const layouted = getLayoutedElements(rfNodes, rfEdges);
    return layouted;
  }

  return { nodes: rfNodes, edges: rfEdges };
}

export function reactFlowToFlow(
  rfNodes: Node[],
  rfEdges: Edge[],
  flow: ChatbotFlow,
): ChatbotFlow {
  const nodes: Record<string, ChatbotNode> = {};

  for (const rfNode of rfNodes) {
    const nodeType = (rfNode.data?.nodeType ?? rfNode.type?.replace("chatbot_", "")) as ChatbotNodeType;
    const { nodeType: _nt, label: _l, ...data } = rfNode.data as Record<string, unknown>;

    const chatbotNode: ChatbotNode = {
      id: rfNode.id,
      type: nodeType,
      data: data as ChatbotNode["data"],
      position: rfNode.position,
      children: [],
    };

    // Reconstruct children from edges
    const childEdges = rfEdges.filter(
      (e) => e.source === rfNode.id && (e.sourceHandle === "default" || !e.sourceHandle),
    );
    chatbotNode.children = childEdges.map((e) => e.target);

    // Reconstruct button options nextNodeId from edges
    if (nodeType === "buttons") {
      const btnData = chatbotNode.data as { options?: Array<{ label: string; nextNodeId: string }> };
      if (btnData.options) {
        for (let i = 0; i < btnData.options.length; i++) {
          const edge = rfEdges.find(
            (e) => e.source === rfNode.id && e.sourceHandle === `option-${i}`,
          );
          btnData.options[i].nextNodeId = edge?.target ?? "";
        }
      }
      // Clear children for buttons (connections are in options)
      chatbotNode.children = [];
    }

    // Reconstruct branch conditions nextNodeId from edges
    if (nodeType === "branch") {
      const brData = chatbotNode.data as {
        conditions?: Array<{ op: string; value: string; nextNodeId: string }>;
        fallbackNodeId?: string;
      };
      if (brData.conditions) {
        for (let i = 0; i < brData.conditions.length; i++) {
          const edge = rfEdges.find(
            (e) => e.source === rfNode.id && e.sourceHandle === `condition-${i}`,
          );
          brData.conditions[i].nextNodeId = edge?.target ?? "";
        }
      }
      const fallbackEdge = rfEdges.find(
        (e) => e.source === rfNode.id && e.sourceHandle === "fallback",
      );
      brData.fallbackNodeId = fallbackEdge?.target ?? undefined;
      chatbotNode.children = [];
    }

    // Reconstruct fallback for ai_response, article_suggest, webhook
    if (["ai_response", "article_suggest", "webhook"].includes(nodeType)) {
      const fallbackEdge = rfEdges.find(
        (e) => e.source === rfNode.id && e.sourceHandle === "fallback",
      );
      const d = chatbotNode.data as Record<string, unknown>;
      if (nodeType === "ai_response") d.fallbackNodeId = fallbackEdge?.target ?? undefined;
      if (nodeType === "article_suggest") d.noResultsNodeId = fallbackEdge?.target ?? undefined;
      if (nodeType === "webhook") d.failureNodeId = fallbackEdge?.target ?? undefined;
    }

    nodes[rfNode.id] = chatbotNode;
  }

  return {
    ...flow,
    nodes,
    updatedAt: new Date().toISOString(),
  };
}

function getNodeLabel(node: ChatbotNode): string {
  switch (node.type) {
    case "message":
      return (node.data as { text: string }).text?.slice(0, 30) || "Message";
    case "buttons":
      return (node.data as { text: string }).text?.slice(0, 30) || "Buttons";
    case "branch":
      return `Branch on ${(node.data as { field: string }).field}`;
    case "action":
      return (node.data as { actionType: string }).actionType;
    case "handoff":
      return "Handoff";
    case "ai_response":
      return "AI Response";
    case "article_suggest":
      return "Article Suggest";
    case "collect_input":
      return `Collect: ${(node.data as { variable: string }).variable}`;
    case "webhook":
      return "Webhook";
    case "delay":
      return `Delay ${(node.data as { seconds: number }).seconds}s`;
    default:
      return node.type;
  }
}
