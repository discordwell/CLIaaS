"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import DashboardGrid from "@/components/DashboardGrid";

interface DashboardDetail {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  layout: Record<string, unknown>;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

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

interface SavedReport {
  id: string;
  name: string;
  metric: string;
  visualization: string;
}

const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 300000 },
];

export default function DashboardDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboards/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDashboard(data.dashboard);
        setWidgets(data.widgets ?? []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Auto-refresh
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (refreshInterval > 0) {
      refreshTimerRef.current = setInterval(() => {
        setRefreshKey((k) => k + 1);
      }, refreshInterval);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [refreshInterval]);

  async function loadReports() {
    setLoadingReports(true);
    try {
      const res = await fetch("/api/reports");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports ?? []);
      }
    } catch {
      /* ignore */
    }
    setLoadingReports(false);
  }

  function handleOpenAddWidget() {
    setShowAddWidget(true);
    loadReports();
  }

  async function handleAddWidget(reportId: string) {
    // Determine next grid position
    const maxY = widgets.reduce((max, w) => Math.max(max, w.gridY + w.gridH), 0);
    const newWidgets = [
      ...widgets.map((w) => ({
        reportId: w.reportId,
        gridX: w.gridX,
        gridY: w.gridY,
        gridW: w.gridW,
        gridH: w.gridH,
        overrides: w.overrides,
      })),
      {
        reportId,
        gridX: 0,
        gridY: maxY,
        gridW: 6,
        gridH: 3,
        overrides: {},
      },
    ];

    try {
      const res = await fetch(`/api/dashboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: newWidgets }),
      });
      if (res.ok) {
        const data = await res.json();
        setWidgets(data.widgets ?? []);
        setShowAddWidget(false);
      }
    } catch {
      /* ignore */
    }
  }

  async function handleRemoveWidget(widgetId: string) {
    const newWidgets = widgets
      .filter((w) => w.id !== widgetId)
      .map((w) => ({
        reportId: w.reportId,
        gridX: w.gridX,
        gridY: w.gridY,
        gridW: w.gridW,
        gridH: w.gridH,
        overrides: w.overrides,
      }));

    try {
      const res = await fetch(`/api/dashboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: newWidgets }),
      });
      if (res.ok) {
        const data = await res.json();
        setWidgets(data.widgets ?? []);
      }
    } catch {
      /* ignore */
    }
  }

  async function handleToggleShare(enabled: boolean) {
    try {
      const res = await fetch(`/api/dashboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enableSharing: enabled,
        }),
      });
      if (res.ok) {
        loadDashboard();
      }
    } catch {
      /* ignore */
    }
  }

  async function handleSaveEdit() {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/dashboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
        }),
      });
      if (res.ok) {
        setEditing(false);
        loadDashboard();
      }
    } catch {
      /* ignore */
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this dashboard and all its widgets?")) return;
    try {
      const res = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/dashboards");
    } catch {
      /* ignore */
    }
  }

  function startEditing() {
    setEditName(dashboard?.name ?? "");
    setEditDescription(dashboard?.description ?? "");
    setEditing(true);
  }

  function toggleFullscreen() {
    if (!fullscreen) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(!fullscreen);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="font-mono text-sm text-zinc-500">Loading dashboard...</p>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="font-mono text-sm text-red-500">Dashboard not found.</p>
      </div>
    );
  }

  return (
    <div className={`mx-auto max-w-7xl px-4 py-8 ${fullscreen ? "fixed inset-0 z-50 bg-white overflow-auto max-w-none" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push("/dashboards")}
            className="font-mono text-xs text-zinc-500 hover:text-zinc-950"
          >
            &larr; Back to Dashboards
          </button>
          {editing ? (
            <div className="mt-2 space-y-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full border-2 border-zinc-300 px-3 py-2 text-lg font-bold focus:border-zinc-950 focus:outline-none"
                autoFocus
              />
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full border-2 border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-950 focus:outline-none"
                placeholder="Description..."
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="border-2 border-zinc-300 px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1
                className="mt-2 cursor-pointer text-2xl font-bold hover:underline"
                onClick={startEditing}
                title="Click to edit"
              >
                {dashboard.name}
              </h1>
              {dashboard.description && (
                <p className="mt-1 text-sm text-zinc-600">
                  {dashboard.description}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                {dashboard.isDefault && (
                  <span className="bg-zinc-950 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
                    Default
                  </span>
                )}
                <span className="bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                  {widgets.length} widget{widgets.length !== 1 ? "s" : ""}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleOpenAddWidget}
            className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Add Widget
          </button>
          <button
            onClick={() => setShowShare(!showShare)}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Share
          </button>
          <button
            onClick={toggleFullscreen}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          <button
            onClick={handleDelete}
            className="border-2 border-red-300 px-3 py-1.5 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Share panel */}
      {showShare && (
        <div className="mt-4 border-2 border-zinc-200 p-4">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            Share Dashboard
          </p>
          {dashboard.shareToken ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/dashboards/share/${dashboard.shareToken}`}
                  className="flex-1 border-2 border-zinc-300 px-3 py-1.5 text-sm font-mono"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/api/dashboards/share/${dashboard.shareToken}`
                    );
                  }}
                  className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
                >
                  Copy
                </button>
              </div>
              <button
                onClick={() => handleToggleShare(false)}
                className="border-2 border-red-300 px-3 py-1 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
              >
                Disable Sharing
              </button>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-sm text-zinc-600">
                Sharing is disabled. Enable it to generate a public link.
              </p>
              <button
                onClick={() => handleToggleShare(true)}
                className="mt-2 border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Enable Sharing
              </button>
            </div>
          )}
        </div>
      )}

      {/* Controls bar */}
      <div className="mt-6 flex flex-wrap items-end gap-4 border-b border-zinc-200 pb-4">
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
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Auto-Refresh
          </label>
          <div className="mt-1 flex gap-1">
            {REFRESH_INTERVALS.map((ri) => (
              <button
                key={ri.value}
                onClick={() => setRefreshInterval(ri.value)}
                className={`border-2 px-2 py-1 font-mono text-[10px] font-bold uppercase ${
                  refreshInterval === ri.value
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 hover:bg-zinc-100"
                }`}
              >
                {ri.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          Refresh
        </button>
      </div>

      {/* Add Widget Modal */}
      {showAddWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="mx-4 w-full max-w-lg border-2 border-zinc-950 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                Add Widget from Report
              </p>
              <button
                onClick={() => setShowAddWidget(false)}
                className="font-mono text-xs text-zinc-500 hover:text-zinc-950"
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-80 overflow-y-auto">
              {loadingReports ? (
                <p className="font-mono text-sm text-zinc-500">
                  Loading reports...
                </p>
              ) : reports.length === 0 ? (
                <p className="font-mono text-sm text-zinc-500">
                  No saved reports found. Create a report first.
                </p>
              ) : (
                <div className="space-y-2">
                  {reports.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleAddWidget(r.id)}
                      className="flex w-full items-center justify-between border-2 border-zinc-200 p-3 text-left transition-colors hover:border-zinc-950"
                    >
                      <div>
                        <p className="font-bold text-sm">{r.name}</p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase text-zinc-500">
                          {r.metric.replace(/_/g, " ")} / {r.visualization}
                        </p>
                      </div>
                      <span className="font-mono text-xs font-bold uppercase text-zinc-400">
                        +
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Widget Grid */}
      <div className="mt-6">
        {widgets.length === 0 ? (
          <div className="border-2 border-dashed border-zinc-300 p-12 text-center">
            <p className="font-mono text-sm text-zinc-500">
              This dashboard has no widgets yet.
            </p>
            <button
              onClick={handleOpenAddWidget}
              className="mt-4 border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Add Your First Widget
            </button>
          </div>
        ) : (
          <DashboardGrid
            widgets={widgets}
            dateOverrides={from && to ? { from, to } : undefined}
            refreshKey={refreshKey}
            onRemoveWidget={handleRemoveWidget}
          />
        )}
      </div>
    </div>
  );
}
