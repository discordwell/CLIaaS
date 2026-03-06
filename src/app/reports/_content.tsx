"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReportResult } from "@/lib/reports/engine";

const ChartRenderer = dynamic(
  () => import("@/components/charts/ChartRenderer"),
  { ssr: false }
);

interface SavedReport {
  id: string;
  name: string;
  description?: string;
  metric: string;
  groupBy: string[];
  visualization: string;
  isTemplate: boolean;
  createdAt: string;
}

const METRICS = [
  { key: "ticket_volume", label: "Ticket Volume" },
  { key: "tickets_resolved", label: "Tickets Resolved" },
  { key: "tickets_open", label: "Tickets Open" },
  { key: "avg_first_response_time", label: "Avg First Response Time" },
  { key: "avg_resolution_time", label: "Avg Resolution Time" },
  { key: "sla_compliance_rate", label: "SLA Compliance Rate" },
  { key: "csat_score", label: "CSAT Score" },
  { key: "nps_score", label: "NPS Score" },
  { key: "ces_score", label: "CES Score" },
  { key: "agent_tickets_handled", label: "Agent Tickets Handled" },
  { key: "channel_breakdown", label: "Channel Breakdown" },
  { key: "top_tags", label: "Top Tags" },
  { key: "priority_distribution", label: "Priority Distribution" },
  { key: "ai_resolution_rate", label: "AI Resolution Rate" },
  { key: "backlog_age", label: "Backlog Age" },
  { key: "replies_per_ticket", label: "Replies per Ticket" },
];

const GROUP_BY_OPTIONS = [
  "date",
  "status",
  "priority",
  "channel",
  "assignee",
  "tag",
  "source",
];

const VIZ_OPTIONS = [
  { key: "bar", label: "Bar" },
  { key: "line", label: "Line" },
  { key: "pie", label: "Pie" },
  { key: "number", label: "Number" },
];

export default function ReportsPageContent() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "builder">("list");
  const [filterTemplates, setFilterTemplates] = useState(false);

  // Builder state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metric, setMetric] = useState("ticket_volume");
  const [groupBy, setGroupBy] = useState<string[]>(["date"]);
  const [viz, setViz] = useState("bar");
  const [preview, setPreview] = useState<ReportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const q = filterTemplates ? "?template=true" : "";
      const res = await fetch(`/api/reports${q}`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [filterTemplates]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Preview",
          metric,
          groupBy,
          visualization: viz,
          preview: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const tempId = data.report?.id;
        if (tempId) {
          const execRes = await fetch(`/api/reports/${tempId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (execRes.ok) {
            const execData = await execRes.json();
            setPreview(execData.result);
          }
          // Clean up the temporary report
          fetch(`/api/reports/${tempId}`, { method: "DELETE" }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
    setPreviewing(false);
  }

  async function handleRunPreview() {
    setPreviewing(true);
    try {
      // Direct execution without saving — POST to a temp report then execute
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "__preview__",
          metric,
          groupBy,
          visualization: viz,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const reportId = data.report?.id;
        if (reportId) {
          const execRes = await fetch(`/api/reports/${reportId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (execRes.ok) {
            const execData = await execRes.json();
            setPreview(execData.result);
          }
          // Clean up preview report
          await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
        }
      }
    } catch { /* ignore */ }
    setPreviewing(false);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          metric,
          groupBy,
          visualization: viz,
        }),
      });
      if (res.ok) {
        setTab("list");
        setName("");
        setDescription("");
        setPreview(null);
        loadReports();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  function toggleGroupBy(dim: string) {
    setGroupBy((prev) =>
      prev.includes(dim) ? prev.filter((d) => d !== dim) : [...prev, dim]
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("list")}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase ${
              tab === "list"
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 hover:bg-zinc-100"
            }`}
          >
            Saved Reports
          </button>
          <button
            onClick={() => setTab("builder")}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase ${
              tab === "builder"
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-300 hover:bg-zinc-100"
            }`}
          >
            New Report
          </button>
        </div>
      </div>

      {tab === "list" && (
        <div className="mt-6">
          <div className="mb-4 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filterTemplates}
                onChange={(e) => setFilterTemplates(e.target.checked)}
                className="accent-zinc-950"
              />
              <span className="font-mono text-xs uppercase">
                Templates only
              </span>
            </label>
          </div>

          {loading ? (
            <p className="font-mono text-sm text-zinc-500">Loading...</p>
          ) : reports.length === 0 ? (
            <div className="border-2 border-dashed border-zinc-300 p-8 text-center">
              <p className="font-mono text-sm text-zinc-500">
                No reports found.
              </p>
              <button
                onClick={() => setTab("builder")}
                className="mt-4 border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Create Your First Report
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {reports.map((r) => (
                <Link
                  key={r.id}
                  href={`/reports/${r.id}`}
                  className="block border-2 border-zinc-200 p-4 transition-colors hover:border-zinc-950"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-bold">{r.name}</h3>
                    {r.isTemplate && (
                      <span className="bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                        Template
                      </span>
                    )}
                  </div>
                  {r.description && (
                    <p className="mt-1 text-sm text-zinc-600">
                      {r.description}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                      {r.metric.replace(/_/g, " ")}
                    </span>
                    <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                      {r.visualization}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "builder" && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Report Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
                placeholder="My Custom Report"
              />
            </div>

            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
                placeholder="Optional description..."
              />
            </div>

            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Metric
              </label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
              >
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Group By
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {GROUP_BY_OPTIONS.map((dim) => (
                  <button
                    key={dim}
                    onClick={() => toggleGroupBy(dim)}
                    className={`border-2 px-3 py-1 font-mono text-xs font-bold uppercase ${
                      groupBy.includes(dim)
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    {dim}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
                Visualization
              </label>
              <div className="mt-1 flex gap-2">
                {VIZ_OPTIONS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setViz(v.key)}
                    className={`border-2 px-3 py-1 font-mono text-xs font-bold uppercase ${
                      viz === v.key
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleRunPreview}
                disabled={previewing}
                className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100 disabled:opacity-50"
              >
                {previewing ? "Running..." : "Preview"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Report"}
              </button>
            </div>
          </div>

          <div className="border-2 border-zinc-200 p-4">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Preview
            </p>
            <div className="mt-4" style={{ minHeight: 300 }}>
              {preview ? (
                <ChartRenderer result={preview} visualization={viz} />
              ) : (
                <div className="flex h-64 items-center justify-center text-zinc-400">
                  <p className="font-mono text-sm">
                    Click &ldquo;Preview&rdquo; to see results
                  </p>
                </div>
              )}
            </div>
            {preview && (
              <div className="mt-4 border-t border-zinc-200 pt-4">
                <p className="font-mono text-xs text-zinc-500">
                  Summary:{" "}
                  {Object.entries(preview.summary)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
