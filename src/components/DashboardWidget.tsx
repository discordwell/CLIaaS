"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { ReportResult } from "@/lib/reports/engine";

const ChartRenderer = dynamic(
  () => import("@/components/charts/ChartRenderer"),
  { ssr: false }
);

interface DashboardWidgetProps {
  reportId: string;
  overrides: Record<string, unknown>;
  w: number;
  h: number;
  refreshKey: number;
}

interface ReportMeta {
  name: string;
  visualization: string;
}

/**
 * Single widget frame that fetches and displays a report execution.
 * Mounted inside DashboardGrid cells.
 */
export default function DashboardWidget({
  reportId,
  overrides,
  w,
  h,
  refreshKey,
}: DashboardWidgetProps) {
  const [report, setReport] = useState<ReportMeta | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAndExecute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch report metadata
      const metaRes = await fetch(`/api/reports/${reportId}`);
      if (!metaRes.ok) {
        setError("Failed to load report");
        setLoading(false);
        return;
      }
      const metaData = await metaRes.json();
      const rpt = metaData.report;
      setReport({ name: rpt.name, visualization: rpt.visualization });

      // Execute report with overrides
      const body: Record<string, unknown> = {};
      if (overrides.from || overrides.to) {
        body.dateRange = { from: overrides.from, to: overrides.to };
      }

      const execRes = await fetch(`/api/reports/${reportId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (execRes.ok) {
        const execData = await execRes.json();
        setResult(execData.result);
      } else {
        setError("Failed to execute report");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }, [reportId, overrides.from, overrides.to]);

  useEffect(() => {
    loadAndExecute();
  }, [loadAndExecute, refreshKey]);

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
        <p className="font-mono text-[10px] font-bold uppercase text-zinc-500 truncate">
          {report?.name ?? "Loading..."}
        </p>
        {report?.visualization && (
          <span className="bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
            {report.visualization}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1" style={{ minHeight: Math.max((h * 120) - 80, 120) }}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm text-zinc-400">Loading...</p>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm text-red-400">{error}</p>
          </div>
        ) : result && report ? (
          <ChartRenderer result={result} visualization={report.visualization} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm text-zinc-400">No data</p>
          </div>
        )}
      </div>
    </div>
  );
}
