"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

/* ---------- Types ---------- */

interface PluginInstallation {
  id: string;
  workspaceId: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionLog {
  id: string;
  installationId: string;
  workspaceId: string;
  hookName: string;
  status: string;
  durationMs: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: string;
}

interface Credentials {
  keys: string[];
  credentials: Record<string, string>;
}

/* ---------- Helpers ---------- */

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusBadge(enabled: boolean) {
  return enabled ? (
    <span className="border-2 border-line bg-emerald-400 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-black">
      Enabled
    </span>
  ) : (
    <span className="border-2 border-line bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-700">
      Disabled
    </span>
  );
}

function logStatusBadge(status: string) {
  const isOk = status === "ok" || status === "success";
  return (
    <span
      className={`border-2 border-line px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
        isOk
          ? "bg-emerald-400 text-black"
          : "bg-red-500 text-white"
      }`}
    >
      {status}
    </span>
  );
}

/* ---------- Plugin Card ---------- */

function PluginCard({
  installation,
  onToggle,
  onUninstall,
  onSaveConfig,
  onSaveCredentials,
}: {
  installation: PluginInstallation;
  onToggle: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onSaveConfig: (id: string, config: Record<string, unknown>) => void;
  onSaveCredentials: (id: string, credentials: Record<string, string>) => void;
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [configEntries, setConfigEntries] = useState<[string, string][]>([]);
  const [credentialEntries, setCredentialEntries] = useState<[string, string][]>([]);
  const [credentialMasks, setCredentialMasks] = useState<Record<string, string>>({});
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  // Initialize config entries from installation config (excluding internal keys)
  useEffect(() => {
    const entries = Object.entries(installation.config)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [k, String(v)] as [string, string]);
    if (entries.length === 0) entries.push(["", ""]);
    setConfigEntries(entries);
  }, [installation.config]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/plugins/${installation.id}/logs?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
      }
    } catch {
      // silent
    } finally {
      setLogsLoading(false);
    }
  }, [installation.id]);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/${installation.id}/credentials`);
      if (res.ok) {
        const data: Credentials = await res.json();
        setCredentialMasks(data.credentials ?? {});
        const entries = (data.keys ?? []).map((k) => [k, ""] as [string, string]);
        if (entries.length === 0) entries.push(["", ""]);
        setCredentialEntries(entries);
      }
    } catch {
      setCredentialEntries([["", ""]]);
    }
    setCredentialsLoaded(true);
  }, [installation.id]);

  useEffect(() => {
    if (showLogs && logs.length === 0 && !logsLoading) {
      fetchLogs();
    }
  }, [showLogs, logs.length, logsLoading, fetchLogs]);

  useEffect(() => {
    if (showConfig && !credentialsLoaded) {
      fetchCredentials();
    }
  }, [showConfig, credentialsLoaded, fetchCredentials]);

  const handleSaveConfig = () => {
    const config: Record<string, unknown> = {};
    for (const [key, value] of configEntries) {
      if (key.trim()) config[key.trim()] = value;
    }
    onSaveConfig(installation.id, config);
  };

  const handleSaveCredentials = () => {
    const creds: Record<string, string> = {};
    for (const [key, value] of credentialEntries) {
      if (key.trim() && value.trim()) creds[key.trim()] = value;
    }
    if (Object.keys(creds).length > 0) {
      onSaveCredentials(installation.id, creds);
    }
  };

  const addConfigRow = () => setConfigEntries((prev) => [...prev, ["", ""]]);
  const removeConfigRow = (idx: number) =>
    setConfigEntries((prev) => prev.filter((_, i) => i !== idx));
  const updateConfigRow = (idx: number, pos: 0 | 1, val: string) =>
    setConfigEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== idx) return entry;
        const copy: [string, string] = [...entry];
        copy[pos] = val;
        return copy;
      })
    );

  const addCredentialRow = () => setCredentialEntries((prev) => [...prev, ["", ""]]);
  const removeCredentialRow = (idx: number) =>
    setCredentialEntries((prev) => prev.filter((_, i) => i !== idx));
  const updateCredentialRow = (idx: number, pos: 0 | 1, val: string) =>
    setCredentialEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== idx) return entry;
        const copy: [string, string] = [...entry];
        copy[pos] = val;
        return copy;
      })
    );

  return (
    <div className="border-2 border-line bg-panel">
      {/* Card Header */}
      <div className="flex items-center justify-between p-6">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="font-mono text-lg font-bold text-foreground">
              {installation.pluginId}
            </h3>
            <span className="border-2 border-line px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-muted">
              v{installation.version}
            </span>
            {statusBadge(installation.enabled)}
          </div>
          <div className="mt-2 flex items-center gap-4 font-mono text-xs text-muted">
            {installation.installedBy && (
              <span>
                <span className="uppercase">By</span>{" "}
                {installation.installedBy}
              </span>
            )}
            <span>
              <span className="uppercase">Installed</span>{" "}
              {formatDate(installation.createdAt)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggle(installation.id, !installation.enabled)}
            className={`border-2 border-line px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
              installation.enabled
                ? "bg-amber-400 text-black hover:bg-amber-300"
                : "bg-emerald-400 text-black hover:bg-emerald-300"
            }`}
          >
            {installation.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => setShowConfig((prev) => !prev)}
            className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            Configure
          </button>
          <button
            onClick={() => setShowLogs((prev) => !prev)}
            className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            View Logs
          </button>
          {!confirmUninstall ? (
            <button
              onClick={() => setConfirmUninstall(true)}
              className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
            >
              Uninstall
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onUninstall(installation.id)}
                className="border-2 border-red-500 bg-red-500 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-red-600"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmUninstall(false)}
                className="border-2 border-line bg-panel px-3 py-2 font-mono text-xs font-bold uppercase text-muted hover:bg-accent-soft"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Configure Section */}
      {showConfig && (
        <div className="border-t-2 border-line p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Configuration
          </p>

          {/* Key-Value Config */}
          <div className="mt-4 space-y-2">
            {configEntries.map(([key, value], idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => updateConfigRow(idx, 0, e.target.value)}
                  placeholder="Key"
                  className="w-40 border-2 border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateConfigRow(idx, 1, e.target.value)}
                  placeholder="Value"
                  className="flex-1 border-2 border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
                />
                <button
                  onClick={() => removeConfigRow(idx)}
                  className="border-2 border-line bg-panel px-2 py-2 font-mono text-xs font-bold text-muted hover:bg-accent-soft hover:text-foreground"
                >
                  X
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <button
                onClick={addConfigRow}
                className="border-2 border-line bg-panel px-3 py-1.5 font-mono text-xs font-bold uppercase text-muted hover:bg-accent-soft hover:text-foreground"
              >
                + Add Field
              </button>
              <button
                onClick={handleSaveConfig}
                className="border-2 border-line bg-foreground px-4 py-1.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90"
              >
                Save Config
              </button>
            </div>
          </div>

          {/* Credentials */}
          <div className="mt-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Credentials (Encrypted)
            </p>
            <div className="mt-3 space-y-2">
              {credentialEntries.map(([key, value], idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => updateCredentialRow(idx, 0, e.target.value)}
                    placeholder="Credential key"
                    className="w-40 border-2 border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  <input
                    type="password"
                    value={value}
                    onChange={(e) => updateCredentialRow(idx, 1, e.target.value)}
                    placeholder={
                      credentialMasks[key]
                        ? credentialMasks[key]
                        : "Secret value"
                    }
                    className="flex-1 border-2 border-line bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  <button
                    onClick={() => removeCredentialRow(idx)}
                    className="border-2 border-line bg-panel px-2 py-2 font-mono text-xs font-bold text-muted hover:bg-accent-soft hover:text-foreground"
                  >
                    X
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={addCredentialRow}
                  className="border-2 border-line bg-panel px-3 py-1.5 font-mono text-xs font-bold uppercase text-muted hover:bg-accent-soft hover:text-foreground"
                >
                  + Add Credential
                </button>
                <button
                  onClick={handleSaveCredentials}
                  className="border-2 border-line bg-foreground px-4 py-1.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90"
                >
                  Save Credentials
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Execution Logs Section */}
      {showLogs && (
        <div className="border-t-2 border-line p-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Execution Logs
            </p>
            <button
              onClick={fetchLogs}
              className="border-2 border-line bg-panel px-3 py-1 font-mono text-xs font-bold uppercase text-muted hover:bg-accent-soft hover:text-foreground"
            >
              Refresh
            </button>
          </div>
          {logsLoading ? (
            <p className="mt-4 font-mono text-xs text-muted">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="mt-4 font-mono text-xs text-muted">
              No execution logs recorded.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b-2 border-line text-left">
                    <th className="px-3 py-2 font-bold uppercase tracking-wider text-muted">
                      Timestamp
                    </th>
                    <th className="px-3 py-2 font-bold uppercase tracking-wider text-muted">
                      Hook
                    </th>
                    <th className="px-3 py-2 font-bold uppercase tracking-wider text-muted">
                      Status
                    </th>
                    <th className="px-3 py-2 font-bold uppercase tracking-wider text-muted">
                      Duration
                    </th>
                    <th className="px-3 py-2 font-bold uppercase tracking-wider text-muted">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-line transition-colors hover:bg-accent-soft"
                    >
                      <td className="px-3 py-2 text-muted">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-bold text-foreground">
                        {log.hookName}
                      </td>
                      <td className="px-3 py-2">{logStatusBadge(log.status)}</td>
                      <td className="px-3 py-2 text-muted">{log.durationMs}ms</td>
                      <td className="max-w-xs truncate px-3 py-2 text-red-500">
                        {log.error ?? "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function PluginsPage() {
  const [installations, setInstallations] = useState<PluginInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInstallations = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins?source=installations");
      if (!res.ok) throw new Error("Failed to fetch plugins");
      const data = await res.json();
      setInstallations(data.installations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstallations();
  }, [fetchInstallations]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/plugins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setInstallations((prev) =>
          prev.map((inst) =>
            inst.id === id ? { ...inst, enabled, updatedAt: new Date().toISOString() } : inst
          )
        );
      }
    } catch {
      // silent
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      const res = await fetch(`/api/plugins/${id}`, { method: "DELETE" });
      if (res.ok) {
        setInstallations((prev) => prev.filter((inst) => inst.id !== id));
      }
    } catch {
      // silent
    }
  };

  const handleSaveConfig = async (id: string, config: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/plugins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (res.ok) {
        setInstallations((prev) =>
          prev.map((inst) =>
            inst.id === id ? { ...inst, config, updatedAt: new Date().toISOString() } : inst
          )
        );
      }
    } catch {
      // silent
    }
  };

  const handleSaveCredentials = async (
    id: string,
    credentials: Record<string, string>
  ) => {
    try {
      await fetch(`/api/plugins/${id}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
    } catch {
      // silent
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-foreground">
            Installed Plugins
          </h1>
          <span className="border-2 border-line bg-foreground px-3 py-1 font-mono text-xs font-bold text-background">
            {loading ? "--" : installations.length}
          </span>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mt-6 border-2 border-red-500 bg-red-50 p-4 font-mono text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mt-10 text-center font-mono text-sm text-muted">
          Loading plugins...
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && installations.length === 0 && (
        <div className="mt-10 border-2 border-line bg-panel p-12 text-center">
          <p className="font-mono text-sm text-muted">
            No plugins installed.
          </p>
          <Link
            href="/dashboard/marketplace"
            className="mt-4 inline-block border-2 border-line bg-panel px-6 py-3 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            Browse the Marketplace &rarr;
          </Link>
        </div>
      )}

      {/* Plugin Cards */}
      {!loading && installations.length > 0 && (
        <div className="mt-8 space-y-4">
          {installations.map((inst) => (
            <PluginCard
              key={inst.id}
              installation={inst}
              onToggle={handleToggle}
              onUninstall={handleUninstall}
              onSaveConfig={handleSaveConfig}
              onSaveCredentials={handleSaveCredentials}
            />
          ))}
        </div>
      )}
    </main>
  );
}
