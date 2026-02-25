"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Shared types (mirroring lib interfaces) ----

interface SecureAuditEntry {
  id: string;
  sequence: number;
  timestamp: string;
  actor: { type: "user" | "system" | "api"; id: string; name: string; ip: string };
  action: string;
  resource: { type: string; id: string };
  outcome: "success" | "failure" | "denied";
  details: Record<string, unknown>;
  hash: string;
  prevHash: string;
}

interface AccessReviewReport {
  generatedAt: string;
  totalUsers: number;
  byRole: Record<string, number>;
  privilegedAccess: Array<{
    userId: string;
    name: string;
    role: string;
    lastActive: string;
  }>;
  recommendations: string[];
}

interface SOC2Control {
  id: string;
  category: string;
  name: string;
  description: string;
  status: "implemented" | "partial" | "planned" | "not_applicable";
  evidence: string[];
  lastReviewedAt?: string;
}

interface EvidencePackage {
  generatedAt: string;
  framework: "SOC 2 Type II";
  trustServiceCategories: string[];
  controls: SOC2Control[];
  summary: { implemented: number; partial: number; planned: number; total: number };
}

// ---- Tab definitions ----

type Tab = "audit" | "access" | "controls" | "evidence";

const TABS: { key: Tab; label: string }[] = [
  { key: "audit", label: "Audit Log" },
  { key: "access", label: "Access Review" },
  { key: "controls", label: "SOC 2 Controls" },
  { key: "evidence", label: "Evidence Export" },
];

// ---- Helpers ----

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const outcomeBadge: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  failure: "bg-red-100 text-red-700",
  denied: "bg-amber-100 text-amber-700",
};

const statusBadge: Record<string, string> = {
  implemented: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  planned: "bg-blue-100 text-blue-700",
  not_applicable: "bg-zinc-200 text-zinc-600",
};

// ======================== MAIN COMPONENT ========================

export default function SecurityPage() {
  const [tab, setTab] = useState<Tab>("audit");

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              SOC 2 Compliance
            </p>
            <h1 className="mt-2 text-3xl font-bold">Security Dashboard</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                tab === t.key
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      <div className="mt-8">
        {tab === "audit" && <AuditLogTab />}
        {tab === "access" && <AccessReviewTab />}
        {tab === "controls" && <ControlsTab />}
        {tab === "evidence" && <EvidenceTab />}
      </div>
    </main>
  );
}

// ======================== AUDIT LOG TAB ========================

function AuditLogTab() {
  const [entries, setEntries] = useState<SecureAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    brokenAt?: number;
    totalEntries: number;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      if (actionFilter) params.set("action", actionFilter);
      params.set("limit", "50");
      const res = await fetch(`/api/security/audit?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total ?? 0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [outcomeFilter, actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/security/audit/verify", { method: "POST" });
      const data = await res.json();
      setVerifyResult(data);
    } catch {
      setVerifyResult(null);
    } finally {
      setVerifying(false);
    }
  }

  function handleExport(format: "csv" | "json") {
    const params = new URLSearchParams();
    params.set("format", format);
    if (outcomeFilter) params.set("outcome", outcomeFilter);
    if (actionFilter) params.set("action", actionFilter);
    window.open(`/api/security/audit/export?${params}`, "_blank");
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-bold">
          {total} Secure Audit Entr{total !== 1 ? "ies" : "y"}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="border-2 border-emerald-600 bg-emerald-600 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {verifying ? "Verifying..." : "Verify Chain"}
          </button>
          <button
            onClick={() => handleExport("csv")}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Export CSV
          </button>
          <button
            onClick={() => handleExport("json")}
            className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Chain verification result */}
      {verifyResult && (
        <div
          className={`mb-4 border-2 p-4 font-mono text-sm ${
            verifyResult.valid
              ? "border-emerald-600 bg-emerald-50 text-emerald-800"
              : "border-red-600 bg-red-50 text-red-800"
          }`}
        >
          {verifyResult.valid ? (
            <span>
              CHAIN INTEGRITY VERIFIED — {verifyResult.totalEntries} entries,
              all hashes valid
            </span>
          ) : (
            <span>
              CHAIN BROKEN at sequence #{verifyResult.brokenAt} — {verifyResult.totalEntries}{" "}
              total entries
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-4">
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-500">
            Outcome
          </span>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="">All outcomes</option>
            {["success", "failure", "denied"].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-500">
            Action
          </span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="">All actions</option>
            {[
              "auth.login",
              "data.access",
              "data.export",
              "data.delete",
              "config.change",
              "permission.change",
              "system.backup",
              "system.maintenance",
              "webhook.receive",
            ].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingBlock label="Loading secure audit log..." />
      ) : entries.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    #
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Time
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Actor
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Action
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Resource
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Outcome
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Details
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    IP
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {e.sequence}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {shortDate(e.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-medium">{e.actor.name}</span>
                        <span className="ml-1 font-mono text-xs text-zinc-400">
                          ({e.actor.type})
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs font-bold">
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {e.resource.type}/{e.resource.id}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                          outcomeBadge[e.outcome] ?? "bg-zinc-200"
                        }`}
                      >
                        {e.outcome}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-500">
                      {Object.entries(e.details)
                        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                        .join(", ") || "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {e.actor.ip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock
          message="No audit entries found"
          sub="Secure audit events will appear here as they occur."
        />
      )}
    </>
  );
}

// ======================== ACCESS REVIEW TAB ========================

function AccessReviewTab() {
  const [report, setReport] = useState<AccessReviewReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/security/access-review");
      const data = await res.json();
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Generating access review..." />;
  if (!report)
    return (
      <EmptyBlock
        message="Failed to generate report"
        sub="Please try again later."
      />
    );

  return (
    <>
      {/* Summary stats */}
      <section className="grid gap-4 sm:grid-cols-4">
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Total Users
          </p>
          <p className="mt-2 text-3xl font-bold">{report.totalUsers}</p>
        </div>
        {Object.entries(report.byRole).map(([role, count]) => (
          <div key={role} className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              {role}s
            </p>
            <p className="mt-2 text-3xl font-bold">{count}</p>
          </div>
        ))}
      </section>

      {/* Privileged Access */}
      <section className="mt-4 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Privileged Access
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  User
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Role
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Last Active
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {report.privilegedAccess.map((u) => {
                const hoursAgo =
                  (Date.now() - new Date(u.lastActive).getTime()) / 3600000;
                const isInactive = hoursAgo > 30 * 24;
                return (
                  <tr
                    key={u.userId}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3">
                      <span className="bg-red-100 px-2 py-0.5 font-mono text-xs font-bold uppercase text-red-700">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {relativeTime(u.lastActive)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                          isInactive
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {isInactive ? "Inactive" : "Active"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recommendations */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
          Recommendations
        </h3>
        <ul className="mt-4 space-y-3">
          {report.recommendations.map((rec, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2 border-zinc-950 bg-zinc-950 font-mono text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="text-sm text-zinc-700">{rec}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 font-mono text-xs text-zinc-400">
        Report generated at {shortDate(report.generatedAt)}
      </p>
    </>
  );
}

// ======================== SOC 2 CONTROLS TAB ========================

function ControlsTab() {
  const [controls, setControls] = useState<SOC2Control[]>([]);
  const [summary, setSummary] = useState<{
    implemented: number;
    partial: number;
    planned: number;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/security/controls");
      const data = await res.json();
      setControls(data.controls || []);
      setSummary(data.summary || null);
    } catch {
      setControls([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock label="Loading SOC 2 controls..." />;

  // Group controls by category
  const grouped: Record<string, SOC2Control[]> = {};
  for (const c of controls) {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  }

  return (
    <>
      {/* Summary stats */}
      {summary && (
        <section className="mb-4 grid gap-4 sm:grid-cols-4">
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Total Controls
            </p>
            <p className="mt-2 text-3xl font-bold">{summary.total}</p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Implemented
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">
              {summary.implemented}
            </p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Partial
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-600">
              {summary.partial}
            </p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Planned
            </p>
            <p className="mt-2 text-3xl font-bold text-blue-600">
              {summary.planned}
            </p>
          </div>
        </section>
      )}

      {/* Controls grouped by category */}
      {Object.entries(grouped).map(([category, categoryControls]) => (
        <section
          key={category}
          className="mb-4 border-2 border-zinc-950 bg-white"
        >
          <div className="border-b-2 border-zinc-950 bg-zinc-50 p-4">
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-700">
              {category}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    ID
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Control
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Evidence
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Last Reviewed
                  </th>
                </tr>
              </thead>
              <tbody>
                {categoryControls.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-bold">
                      {c.id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {c.description}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                          statusBadge[c.status] ?? "bg-zinc-200"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <ul className="space-y-1">
                        {c.evidence.map((ev, i) => (
                          <li
                            key={i}
                            className="font-mono text-xs text-zinc-500"
                          >
                            - {ev}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {c.lastReviewedAt
                        ? relativeTime(c.lastReviewedAt)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

// ======================== EVIDENCE EXPORT TAB ========================

function EvidenceTab() {
  const [pkg, setPkg] = useState<EvidencePackage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/security/evidence");
      const data = await res.json();
      setPkg(data);
    } catch {
      setPkg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleDownloadJson() {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soc2-evidence-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingBlock label="Generating evidence package..." />;
  if (!pkg)
    return (
      <EmptyBlock
        message="Failed to generate evidence"
        sub="Please try again later."
      />
    );

  const completionPct = Math.round(
    (pkg.summary.implemented / pkg.summary.total) * 100,
  );

  return (
    <>
      {/* Summary */}
      <section className="border-2 border-zinc-950 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              {pkg.framework}
            </p>
            <h2 className="mt-2 text-2xl font-bold">Evidence Package</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Generated {shortDate(pkg.generatedAt)}
            </p>
          </div>
          <button
            onClick={handleDownloadJson}
            className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Download JSON
          </button>
        </div>
      </section>

      {/* Completion stats */}
      <section className="mt-4 grid gap-4 sm:grid-cols-4">
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Completion
          </p>
          <p className="mt-2 text-3xl font-bold">{completionPct}%</p>
          <div className="mt-2 h-2 w-full bg-zinc-200">
            <div
              className="h-full bg-emerald-600"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Implemented
          </p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">
            {pkg.summary.implemented}
          </p>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Partial
          </p>
          <p className="mt-2 text-3xl font-bold text-amber-600">
            {pkg.summary.partial}
          </p>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            Planned
          </p>
          <p className="mt-2 text-3xl font-bold text-blue-600">
            {pkg.summary.planned}
          </p>
        </div>
      </section>

      {/* Trust Service Categories */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
          Trust Service Categories
        </h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {pkg.trustServiceCategories.map((cat) => (
            <div
              key={cat}
              className="border border-zinc-200 px-3 py-2 font-mono text-xs"
            >
              {cat}
            </div>
          ))}
        </div>
      </section>

      {/* Control checklist */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
          Control Checklist
        </h3>
        <div className="mt-4 space-y-2">
          {pkg.controls.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border border-zinc-100 px-4 py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center border ${
                    c.status === "implemented"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : c.status === "partial"
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-zinc-300 bg-white"
                  }`}
                >
                  {c.status === "implemented" ? (
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : c.status === "partial" ? (
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M20 12H4"
                      />
                    </svg>
                  ) : null}
                </span>
                <span className="font-mono text-xs font-bold text-zinc-500">
                  {c.id}
                </span>
                <span className="text-sm">{c.name}</span>
              </div>
              <span
                className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                  statusBadge[c.status] ?? "bg-zinc-200"
                }`}
              >
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ======================== SHARED SUB-COMPONENTS ========================

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="border-2 border-zinc-950 bg-white p-8 text-center">
      <p className="font-mono text-sm text-zinc-500">{label}</p>
    </section>
  );
}

function EmptyBlock({ message, sub }: { message: string; sub: string }) {
  return (
    <section className="border-2 border-zinc-950 bg-white p-8 text-center">
      <p className="text-lg font-bold">{message}</p>
      <p className="mt-2 text-sm text-zinc-600">{sub}</p>
    </section>
  );
}
