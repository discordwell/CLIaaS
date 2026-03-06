"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface FlowCanvasBaseProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  nodeTypes: NodeTypes;
  edgeTypes?: EdgeTypes;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  onPaneClick?: () => void;
  onDrop?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDelete?: (params: { nodes: Node[]; edges: Edge[] }) => void;
  children?: React.ReactNode;
  fitView?: boolean;
}

export function FlowCanvasBase({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  nodeTypes,
  edgeTypes,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onDrop,
  onDragOver,
  onDelete,
  children,
  fitView = true,
}: FlowCanvasBaseProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onPaneClick?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onPaneClick]);

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      onDragOver?.(event);
    },
    [onDragOver],
  );

  return (
    <div ref={reactFlowWrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={handleDragOver}
        onDelete={onDelete}
        fitView={fitView}
        fitViewOptions={{ padding: 0.2 }}
        snapToGrid
        snapGrid={[10, 10]}
        deleteKeyCode={["Delete", "Backspace"]}
        minZoom={0.25}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: false,
          style: { strokeWidth: 2, stroke: "#09090b" },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e4e4e7" />
        <Controls showInteractive={false} />
        <MiniMap
          zoomable
          pannable
          style={{ border: "2px solid #09090b", borderRadius: 0 }}
          maskColor="rgba(9,9,11,0.08)"
        />
        {children && <Panel position="top-right">{children}</Panel>}
      </ReactFlow>
    </div>
  );
}
