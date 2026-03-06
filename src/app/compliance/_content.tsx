"use client";

import { useEffect, useState, useCallback } from "react";

type Tab =
  | "overview"
  | "detections"
  | "redaction-log"
  | "rules"
  | "retention"
  | "gdpr"
  | "hipaa"
  | "access-log";

interface PiiDetection {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  piiType: string;
  maskedValue: string;
  confidence: number;
  status: string;
  createdAt: string;
}

interface PiiStats {
  total: number;
  pending: number;
  confirmed: number;
  redacted: number;
  dismissed: number;
  autoRedacted: number;
  byType: Record<string, number>;
}

interface RedactionLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  maskedValue: string;
  reason: string | null;
  createdAt: string;
}

interface SensitivityRule {
  piiType: string;
  enabled: boolean;
  autoRedact: boolean;
  maskingStyle: string;
  customPattern?: string;
}

interface ScanJob {
  id: string;
  entityTypes: string[];
  status: string;
  totalRecords: number;
  scannedRecords: number;
  detectionsFound: number;
  createdAt: string;
}

interface HipaaControl {
  id: string;
  category: string;
  name: string;
  description: string;
  status: "pass" | "fail" | "partial" | "na";
  evidence: string[];
  remediation?: string;
}

interface BaaRecord {
  id: string;
  partnerName: string;
  partnerEmail: string;
  status: string;
  signedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface AccessLogEntry {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  piiType: string;
  accessType: string;
  createdAt: string;
}

interface RetentionPolicy {
  id: string;
  resource: string;
  retentionDays: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "detections", label: "PII Detections" },
  { id: "redaction-log", label: "Redaction Log" },
  { id: "rules", label: "Sensitivity Rules" },
  { id: "retention", label: "Retention" },
  { id: "gdpr", label: "GDPR" },
  { id: "hipaa", label: "HIPAA" },
  { id: "access-log", label: "Access Log" },
];

const PII_TYPES = [
  "ssn",
  "credit_card",
  "phone",
  "email",
  "address",
  "dob",
  "medical_id",
  "passport",
  "drivers_license",
  "custom",
];

export default function CompliancePageContent() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<PiiStats | null>(null);
  const [detections, setDetections] = useState<PiiDetection[]>([]);
  const [redactionLog, setRedactionLog] = useState<RedactionLogEntry[]>([]);
  const [rules, setRules] = useState<SensitivityRule[]>([]);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [hipaaControls, setHipaaControls] = useState<HipaaControl[]>([]);
  const [baaRecords, setBaaRecords] = useState<BaaRecord[]>([]);
  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([]);
  const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/pii/stats");
      if (res.ok) setStats(await res.json());
    } catch { /* best-effort */ }
  }, []);

  const fetchDetections = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/compliance/pii/detections?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDetections(data.detections || []);
      }
    } catch { /* best-effort */ }
  }, [statusFilter]);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/pii/rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch { /* best-effort */ }
  }, []);

  const fetchHipaa = useCallback(async () => {
    try {
      const [statusRes, baaRes] = await Promise.all([
        fetch("/api/compliance/hipaa/status"),
        fetch("/api/compliance/hipaa/baa"),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setHipaaControls(data.controls || []);
      }
      if (baaRes.ok) {
        const data = await baaRes.json();
        setBaaRecords(data.records || []);
      }
    } catch { /* best-effort */ }
  }, []);

  const fetchAccessLog = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/pii/access-log?limit=50");
      if (res.ok) {
        const data = await res.json();
        setAccessLog(data.accessLog || []);
      }
    } catch { /* best-effort */ }
  }, []);

  const fetchRetention = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/retention");
      if (res.ok) {
        const data = await res.json();
        setRetentionPolicies(data.policies || []);
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    switch (tab) {
      case "detections": fetchDetections(); break;
      case "rules": fetchRules(); break;
      case "hipaa": fetchHipaa(); break;
      case "access-log": fetchAccessLog(); break;
      case "retention": fetchRetention(); break;
    }
  }, [tab, fetchDetections, fetchRules, fetchHipaa, fetchAccessLog, fetchRetention]);

  const handleReview = async (detectionId: string, action: "confirm" | "dismiss") => {
    setLoading(true);
    try {
      await fetch(`/api/compliance/pii/detections/${detectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      fetchDetections();
      fetchStats();
    } finally {
      setLoading(false);
    }
  };

  const handleRedact = async (detectionId: string) => {
    setLoading(true);
    try {
      await fetch("/api/compliance/pii/redact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detectionId }),
      });
      fetchDetections();
      fetchStats();
    } finally {
      setLoading(false);
    }
  };

  const handleRedactAll = async () => {
    if (!confirm("Redact all confirmed PII detections?")) return;
    setLoading(true);
    try {
      await fetch("/api/compliance/pii/redact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allConfirmed: true }),
      });
      fetchDetections();
      fetchStats();
    } finally {
      setLoading(false);
    }
  };

  const handleRuleToggle = async (piiType: string, field: "enabled" | "autoRedact", value: boolean) => {
    const updated = rules.map((r) =>
      r.piiType === piiType ? { ...r, [field]: value } : r
    );
    setRules(updated);

    try {
      await fetch("/api/compliance/pii/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: updated }),
      });
    } catch { /* best-effort */ }
  };

  const handleStartScan = async () => {
    setLoading(true);
    try {
      await fetch("/api/compliance/pii/scan-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityTypes: ["message", "ticket"] }),
      });
      fetchStats();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Compliance</h1>
        <button
          onClick={handleStartScan}
          disabled={loading}
          className="px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded hover:bg-zinc-700 disabled:opacity-50"
        >
          Run PII Scan
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              tab === t.id
                ? "border-zinc-400 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab stats={stats} onStartScan={handleStartScan} loading={loading} />}
      {tab === "detections" && (
        <DetectionsTab
          detections={detections}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onReview={handleReview}
          onRedact={handleRedact}
          onRedactAll={handleRedactAll}
          loading={loading}
        />
      )}
      {tab === "redaction-log" && <RedactionLogTab />}
      {tab === "rules" && <RulesTab rules={rules} onToggle={handleRuleToggle} />}
      {tab === "retention" && <RetentionTab policies={retentionPolicies} />}
      {tab === "gdpr" && <GdprTab />}
      {tab === "hipaa" && <HipaaTab controls={hipaaControls} baaRecords={baaRecords} />}
      {tab === "access-log" && <AccessLogTab entries={accessLog} />}
    </div>
  );
}

function OverviewTab({ stats, onStartScan, loading }: { stats: PiiStats | null; onStartScan: () => void; loading: boolean }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Detections" value={stats?.total ?? 0} />
        <StatCard label="Pending Review" value={stats?.pending ?? 0} color="text-yellow-400" />
        <StatCard label="Redacted" value={(stats?.redacted ?? 0) + (stats?.autoRedacted ?? 0)} color="text-green-400" />
        <StatCard label="Dismissed" value={stats?.dismissed ?? 0} color="text-zinc-500" />
      </div>

      {stats && Object.keys(stats.byType).length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">Detections by Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(stats.byType).map(([type, count]) => (
              <div key={type} className="flex justify-between items-center px-3 py-2 bg-zinc-800 rounded text-sm">
                <span className="text-zinc-300">{type.replace("_", " ")}</span>
                <span className="text-zinc-100 font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetectionsTab({
  detections,
  statusFilter,
  onStatusFilterChange,
  onReview,
  onRedact,
  onRedactAll,
  loading,
}: {
  detections: PiiDetection[];
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  onReview: (id: string, action: "confirm" | "dismiss") => void;
  onRedact: (id: string) => void;
  onRedactAll: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded px-3 py-1.5"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="redacted">Redacted</option>
          <option value="dismissed">Dismissed</option>
          <option value="auto_redacted">Auto-Redacted</option>
        </select>
        <button
          onClick={onRedactAll}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-red-900/50 border border-red-800 text-red-300 rounded hover:bg-red-900 disabled:opacity-50"
        >
          Redact All Confirmed
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Entity</th>
              <th className="px-4 py-3 text-left font-medium">Field</th>
              <th className="px-4 py-3 text-left font-medium">Masked Value</th>
              <th className="px-4 py-3 text-left font-medium">Confidence</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {detections.map((d) => (
              <tr key={d.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-3">
                  <span className="inline-block px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-300">
                    {d.piiType.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{d.entityType}:{d.entityId.slice(0, 8)}</td>
                <td className="px-4 py-3 text-zinc-400">{d.fieldName}</td>
                <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{d.maskedValue}</td>
                <td className="px-4 py-3 text-zinc-400">{Math.round(d.confidence * 100)}%</td>
                <td className="px-4 py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-4 py-3">
                  {d.status === "pending" && (
                    <div className="flex gap-1">
                      <button onClick={() => onReview(d.id, "confirm")} disabled={loading} className="px-2 py-1 text-xs bg-green-900/50 text-green-300 rounded hover:bg-green-900">Confirm</button>
                      <button onClick={() => onReview(d.id, "dismiss")} disabled={loading} className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700">Dismiss</button>
                    </div>
                  )}
                  {d.status === "confirmed" && (
                    <button onClick={() => onRedact(d.id)} disabled={loading} className="px-2 py-1 text-xs bg-red-900/50 text-red-300 rounded hover:bg-red-900">Redact</button>
                  )}
                </td>
              </tr>
            ))}
            {detections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-600">
                  No PII detections found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RedactionLogTab() {
  const [entries, setEntries] = useState<RedactionLogEntry[]>([]);

  useEffect(() => {
    fetch("/api/compliance/pii/redaction-log?limit=50")
      .then((r) => r.ok ? r.json() : { entries: [] })
      .then((d) => setEntries(d.entries || []))
      .catch(() => {});
  }, []);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-4 py-3 text-left font-medium">Entity</th>
            <th className="px-4 py-3 text-left font-medium">Field</th>
            <th className="px-4 py-3 text-left font-medium">Masked Value</th>
            <th className="px-4 py-3 text-left font-medium">Reason</th>
            <th className="px-4 py-3 text-left font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-zinc-800/50">
              <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{e.entityType}:{e.entityId.slice(0, 8)}</td>
              <td className="px-4 py-3 text-zinc-400">{e.fieldName}</td>
              <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{e.maskedValue}</td>
              <td className="px-4 py-3 text-zinc-400">{e.reason || "—"}</td>
              <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No redactions recorded</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RulesTab({ rules, onToggle }: { rules: SensitivityRule[]; onToggle: (piiType: string, field: "enabled" | "autoRedact", value: boolean) => void }) {
  // Show all PII types, merge with fetched rules
  const mergedRules = PII_TYPES.map((t) => {
    const existing = rules.find((r) => r.piiType === t);
    return existing || { piiType: t, enabled: true, autoRedact: false, maskingStyle: "full" };
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-4 py-3 text-left font-medium">PII Type</th>
            <th className="px-4 py-3 text-center font-medium">Enabled</th>
            <th className="px-4 py-3 text-center font-medium">Auto-Redact</th>
            <th className="px-4 py-3 text-left font-medium">Masking Style</th>
          </tr>
        </thead>
        <tbody>
          {mergedRules.map((r) => (
            <tr key={r.piiType} className="border-b border-zinc-800/50">
              <td className="px-4 py-3 text-zinc-300 capitalize">{r.piiType.replace("_", " ")}</td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => onToggle(r.piiType, "enabled", e.target.checked)}
                  className="accent-zinc-400"
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={r.autoRedact}
                  onChange={(e) => onToggle(r.piiType, "autoRedact", e.target.checked)}
                  className="accent-red-400"
                />
              </td>
              <td className="px-4 py-3 text-zinc-400 capitalize">{r.maskingStyle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RetentionTab({ policies }: { policies: RetentionPolicy[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">Data retention policies control how long different data types are kept before being automatically deleted.</p>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-4 py-3 text-left font-medium">Resource</th>
              <th className="px-4 py-3 text-left font-medium">Retention Period</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-300 capitalize">{p.resource}</td>
                <td className="px-4 py-3 text-zinc-400">{p.retentionDays} days</td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr><td colSpan={2} className="px-4 py-8 text-center text-zinc-600">No retention policies configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GdprTab() {
  const [email, setEmail] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleExport = async () => {
    if (!email) return;
    setExportStatus("Exporting...");
    try {
      const res = await fetch("/api/compliance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setExportStatus("Export complete");
      else setExportStatus("Export failed");
    } catch {
      setExportStatus("Export failed");
    }
  };

  const handleDelete = async () => {
    if (!email) return;
    if (!confirm(`Delete all data for ${email}? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/compliance/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setExportStatus("Deletion complete");
      else setExportStatus("Deletion failed");
    } catch {
      setExportStatus("Deletion failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-lg">
        <h3 className="text-sm font-medium text-zinc-300 mb-4">Data Subject Request</h3>
        <div className="space-y-3">
          <input
            type="email"
            placeholder="User email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded px-3 py-2"
          />
          <div className="flex gap-2">
            <button onClick={handleExport} className="px-4 py-2 bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm rounded hover:bg-zinc-700">
              Export Data
            </button>
            <button onClick={handleDelete} className="px-4 py-2 bg-red-900/50 border border-red-800 text-red-300 text-sm rounded hover:bg-red-900">
              Delete Data
            </button>
          </div>
          {exportStatus && <p className="text-xs text-zinc-500">{exportStatus}</p>}
        </div>
      </div>
    </div>
  );
}

function HipaaTab({ controls, baaRecords }: { controls: HipaaControl[]; baaRecords: BaaRecord[] }) {
  const passCount = controls.filter((c) => c.status === "pass").length;
  const totalApplicable = controls.filter((c) => c.status !== "na").length;
  const percentage = totalApplicable > 0 ? Math.round((passCount / totalApplicable) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Score */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <div className="text-3xl font-bold text-zinc-100">{percentage}%</div>
          <div>
            <div className="text-sm text-zinc-400">HIPAA Readiness Score</div>
            <div className="text-xs text-zinc-600">{passCount} of {totalApplicable} controls passing</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-2">
        {controls.map((c) => (
          <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <ControlStatusIcon status={c.status} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">{c.name}</span>
                  <span className="text-xs text-zinc-600">{c.category}</span>
                </div>
                <p className="text-xs text-zinc-500 mt-1">{c.description}</p>
                {c.evidence.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {c.evidence.map((e, i) => (
                      <div key={i} className="text-xs text-zinc-500">• {e}</div>
                    ))}
                  </div>
                )}
                {c.remediation && (
                  <div className="mt-2 text-xs text-yellow-500/80">Remediation: {c.remediation}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* BAA Records */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Business Associate Agreements</h3>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-4 py-3 text-left font-medium">Partner</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Signed</th>
              </tr>
            </thead>
            <tbody>
              {baaRecords.map((b) => (
                <tr key={b.id} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 text-zinc-300">{b.partnerName}</td>
                  <td className="px-4 py-3 text-zinc-400">{b.partnerEmail}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{b.signedAt ? new Date(b.signedAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {baaRecords.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-600">No BAA records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AccessLogTab({ entries }: { entries: AccessLogEntry[] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-4 py-3 text-left font-medium">User</th>
            <th className="px-4 py-3 text-left font-medium">Entity</th>
            <th className="px-4 py-3 text-left font-medium">Field</th>
            <th className="px-4 py-3 text-left font-medium">PII Type</th>
            <th className="px-4 py-3 text-left font-medium">Access Type</th>
            <th className="px-4 py-3 text-left font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-zinc-800/50">
              <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{e.userId.slice(0, 8)}</td>
              <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{e.entityType}:{e.entityId.slice(0, 8)}</td>
              <td className="px-4 py-3 text-zinc-400">{e.fieldName}</td>
              <td className="px-4 py-3 text-zinc-300">{e.piiType}</td>
              <td className="px-4 py-3 text-zinc-400">{e.accessType}</td>
              <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No access log entries</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className={`text-2xl font-bold ${color || "text-zinc-100"}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-900/50 text-yellow-300",
    confirmed: "bg-blue-900/50 text-blue-300",
    redacted: "bg-green-900/50 text-green-300",
    auto_redacted: "bg-green-900/50 text-green-300",
    dismissed: "bg-zinc-800 text-zinc-500",
    active: "bg-green-900/50 text-green-300",
    expired: "bg-red-900/50 text-red-300",
    pass: "bg-green-900/50 text-green-300",
    fail: "bg-red-900/50 text-red-300",
    partial: "bg-yellow-900/50 text-yellow-300",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${colors[status] || "bg-zinc-800 text-zinc-400"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function ControlStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pass": return <span className="text-green-400 text-lg">✓</span>;
    case "fail": return <span className="text-red-400 text-lg">✗</span>;
    case "partial": return <span className="text-yellow-400 text-lg">◐</span>;
    default: return <span className="text-zinc-600 text-lg">—</span>;
  }
}
