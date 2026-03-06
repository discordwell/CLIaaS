"use client";

import { useCallback, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

const MAX_HISTORY = 20;

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

export function useFlowHistory(
  nodes: Node[],
  edges: Edge[],
  setNodes: (nodes: Node[]) => void,
  setEdges: (edges: Edge[]) => void,
) {
  const historyRef = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const pushSnapshot = useCallback(() => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: structuredClone(nodes), edges: structuredClone(edges) },
    ];
    setCanUndo(true);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const stack = historyRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    historyRef.current = stack.slice(0, -1);
    setNodes(last.nodes);
    setEdges(last.edges);
    setCanUndo(historyRef.current.length > 0);
  }, [setNodes, setEdges]);

  return { pushSnapshot, undo, canUndo };
}
