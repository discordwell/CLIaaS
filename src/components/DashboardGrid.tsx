"use client";

import DashboardWidget from "./DashboardWidget";

interface Widget {
  id: string;
  dashboardId: string;
  reportId: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  overrides: Record<string, unknown>;
}

interface DashboardGridProps {
  widgets: Widget[];
  dateOverrides?: { from: string; to: string };
  refreshKey: number;
  onRemoveWidget?: (widgetId: string) => void;
}

/**
 * CSS Grid-based dashboard layout.
 * Uses a 12-column grid. Widgets are positioned with gridColumn span
 * based on their gridW property. Rows are auto-generated.
 */
export default function DashboardGrid({
  widgets,
  dateOverrides,
  refreshKey,
  onRemoveWidget,
}: DashboardGridProps) {
  // Sort widgets by gridY then gridX for natural flow ordering
  const sorted = [...widgets].sort((a, b) => {
    if (a.gridY !== b.gridY) return a.gridY - b.gridY;
    return a.gridX - b.gridX;
  });

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: "repeat(12, 1fr)",
      }}
    >
      {sorted.map((widget) => {
        const colSpan = Math.min(Math.max(widget.gridW, 1), 12);
        const rowSpan = Math.max(widget.gridH, 1);

        return (
          <div
            key={widget.id}
            style={{
              gridColumn: `span ${colSpan}`,
              gridRow: `span ${rowSpan}`,
              minHeight: `${rowSpan * 120}px`,
            }}
            className="relative border-2 border-zinc-200 bg-white"
          >
            {onRemoveWidget && (
              <button
                onClick={() => onRemoveWidget(widget.id)}
                className="absolute right-2 top-2 z-10 border-2 border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400 hover:border-red-300 hover:text-red-600"
                title="Remove widget"
              >
                x
              </button>
            )}
            <DashboardWidget
              reportId={widget.reportId}
              overrides={{
                ...widget.overrides,
                ...(dateOverrides ? { from: dateOverrides.from, to: dateOverrides.to } : {}),
              }}
              w={colSpan}
              h={rowSpan}
              refreshKey={refreshKey}
            />
          </div>
        );
      })}
    </div>
  );
}
