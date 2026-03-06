"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import DrillDownPanel from "@/components/DrillDownPanel";
import ShareLinkDialog from "@/components/ShareLinkDialog";
import type { ReportResult } from "@/lib/reports/engine";

const ChartRenderer = dynamic(
  () => import("@/components/charts/ChartRenderer"),
  { ssr: false }
);

interface ReportDetail {
  id: string;
  name: string;
  description?: string;
  metric: string;
  groupBy: string[];
  visualization: string;
  shareToken: string | null;
  isTemplate: boolean;
}

export default function ReportDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [drillDown, setDrillDown] = useState<{
    groupKey: string;
    groupValue: string;
  } | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const executeReport = useCallback(async () => {
    setExecuting(true);
    try {
      const body: Record<string, unknown> = {};
      if (from) body.from = from;
      if (to) body.to = to;

      const res = await fetch(`/api/reports/${id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data.result);
      }
    } catch { /* ignore */ }
    setExecuting(false);
  }, [id, from, to]);

  useEffect(() => {
    if (report) executeReport();
  }, [report]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExport(format: "csv" | "json") {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/reports/${id}/export?${params}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report?.name ?? "report"}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
    setExporting(false);
  }

  async function handleToggleShare(enabled: boolean) {
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareToken: enabled ? crypto.randomUUID() : null,
        }),
      });
      if (res.ok) {
        loadReport();
      }
    } catch { /* ignore */ }
  }

  async function handleDelete() {
    if (!confirm("Delete this report?")) return;
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/reports");
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="font-mono text-sm text-zinc-500">Loading report...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <p className="font-mono text-sm text-red-500">Report not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/reports")}
            className="font-mono text-xs text-zinc-500 hover:text-zinc-950"
          >
            &larr; Back to Reports
          </button>
          <h1 className="mt-2 text-2xl font-bold">{report.name}</h1>
          {report.description && (
            <p className="mt-1 text-sm text-zinc-600">{report.description}</p>
          )}
          <div className="mt-2 flex gap-2">
            <span className="bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
              {report.metric.replace(/_/g, " ")}
            </span>
            <span className="bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
              {report.visualization}
            </span>
            {report.isTemplate && (
              <span className="bg-zinc-300 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                Template
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowShare(true)}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Share
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100 disabled:opacity-50"
          >
            CSV
          </button>
          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100 disabled:opacity-50"
          >
            JSON
          </button>
          <button
            onClick={handleDelete}
            className="border-2 border-red-300 px-3 py-1.5 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-end gap-4 border-b border-zinc-200 pb-4">
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
          />
        </div>
        <button
          onClick={executeReport}
          disabled={executing}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {executing ? "Running..." : "Run"}
        </button>
      </div>

      <div className="mt-6" style={{ minHeight: 400 }}>
        {executing && !result ? (
          <div className="flex h-64 items-center justify-center">
            <p className="font-mono text-sm text-zinc-500">
              Executing report...
            </p>
          </div>
        ) : result ? (
          <ChartRenderer
            result={result}
            visualization={report.visualization}
            onCellClick={(groupKey, groupValue) =>
              setDrillDown({ groupKey, groupValue })
            }
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-400">
            <p className="font-mono text-sm">No results yet</p>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 border-t border-zinc-200 pt-4">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            Summary
          </p>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Object.entries(result.summary).map(([key, value]) => (
              <div key={key} className="border border-zinc-200 p-3">
                <p className="font-mono text-[10px] font-bold uppercase text-zinc-500">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-xl font-bold">
                  {typeof value === "number"
                    ? value % 1 === 0
                      ? value
                      : value.toFixed(2)
                    : value}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.rows.length > 0 && (
        <div className="mt-6 border-t border-zinc-200 pt-4">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            Data Table
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {result.columns.map((col) => (
                    <th
                      key={col}
                      className="border-b-2 border-zinc-950 px-3 py-2 text-left font-mono text-xs font-bold uppercase"
                    >
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-zinc-50">
                    {result.columns.map((col) => (
                      <td key={col} className="border-b border-zinc-200 px-3 py-2">
                        {String(row[col] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {drillDown && (
        <DrillDownPanel
          reportId={id}
          groupKey={drillDown.groupKey}
          groupValue={drillDown.groupValue}
          dateRange={from && to ? { from, to } : undefined}
          onClose={() => setDrillDown(null)}
        />
      )}

      {showShare && (
        <ShareLinkDialog
          reportId={id}
          currentToken={report.shareToken}
          onClose={() => setShowShare(false)}
          onToggle={handleToggleShare}
        />
      )}
    </div>
  );
}
