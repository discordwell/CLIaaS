"use client";

import { useEffect, useState, useCallback } from "react";

interface SLAPolicy {
  id: string;
  name: string;
  conditions: {
    priority?: string[];
    tags?: string[];
    source?: string[];
  };
  targets: {
    firstResponse: number;
    resolution: number;
  };
  escalation: Array<{
    afterMinutes: number;
    action: "notify" | "escalate" | "reassign";
    to?: string;
  }>;
  enabled: boolean;
  createdAt: string;
}

interface SLACheckResult {
  ticketId: string;
  policyId: string;
  policyName: string;
  firstResponse: {
    targetMinutes: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    status: "ok" | "warning" | "breached";
  };
  resolution: {
    targetMinutes: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    status: "ok" | "warning" | "breached";
  };
  escalations: Array<{
    afterMinutes: number;
    action: string;
    to?: string;
    triggered: boolean;
  }>;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

const statusBg: Record<string, string> = {
  ok: "bg-emerald-500 text-white",
  warning: "bg-amber-400 text-black",
  breached: "bg-red-500 text-white",
};

export default function SLAPageContent() {
  const [policies, setPolicies] = useState<SLAPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // SLA check state
  const [checkTicketId, setCheckTicketId] = useState("");
  const [checkResults, setCheckResults] = useState<SLACheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    priorities: [] as string[],
    tags: "",
    firstResponseMinutes: 60,
    resolutionMinutes: 1440,
    escalations: [] as Array<{ afterMinutes: number; action: string; to: string }>,
  });

  const loadPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/sla");
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  async function createPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const tags = formData.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      await fetch("/api/sla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          conditions: {
            priority: formData.priorities.length > 0 ? formData.priorities : undefined,
            tags: tags.length > 0 ? tags : undefined,
          },
          targets: {
            firstResponse: formData.firstResponseMinutes,
            resolution: formData.resolutionMinutes,
          },
          escalation: formData.escalations.map((esc) => ({
            afterMinutes: esc.afterMinutes,
            action: esc.action,
            to: esc.to || undefined,
          })),
          enabled: true,
        }),
      });
      setShowForm(false);
      setFormData({
        name: "",
        priorities: [],
        tags: "",
        firstResponseMinutes: 60,
        resolutionMinutes: 1440,
        escalations: [],
      });
      loadPolicies();
    } finally {
      setSaving(false);
    }
  }

  function togglePriority(p: string) {
    setFormData((prev) => ({
      ...prev,
      priorities: prev.priorities.includes(p)
        ? prev.priorities.filter((x) => x !== p)
        : [...prev.priorities, p],
    }));
  }

  function addEscalation() {
    setFormData((prev) => ({
      ...prev,
      escalations: [
        ...prev.escalations,
        { afterMinutes: 30, action: "notify", to: "" },
      ],
    }));
  }

  function removeEscalation(idx: number) {
    setFormData((prev) => ({
      ...prev,
      escalations: prev.escalations.filter((_, i) => i !== idx),
    }));
  }

  function updateEscalation(idx: number, field: string, value: string | number) {
    setFormData((prev) => ({
      ...prev,
      escalations: prev.escalations.map((esc, i) =>
        i === idx ? { ...esc, [field]: value } : esc
      ),
    }));
  }

  async function handleCheck() {
    if (!checkTicketId.trim()) return;
    setChecking(true);
    setCheckError(null);
    setCheckResults(null);
    try {
      const res = await fetch("/api/sla/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: checkTicketId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckError(data.error || `HTTP ${res.status}`);
      } else {
        setCheckResults(data.results || []);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Service Level Agreements
            </p>
            <h1 className="mt-2 text-3xl font-bold">
              {policies.length} SLA Polic{policies.length !== 1 ? "ies" : "y"}
            </h1>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowForm(!showForm)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {showForm ? "Cancel" : "New Policy"}
            </button>
          </div>
        </div>
      </header>

      {/* CREATE FORM */}
      {showForm && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Create SLA Policy</h2>
          <form onSubmit={createPolicy} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">Policy Name</span>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                  placeholder="e.g., Premium Support SLA"
                />
              </label>
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">Tags (comma-separated)</span>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                  placeholder="e.g., vip, enterprise"
                />
              </label>
            </div>

            {/* Priority conditions */}
            <div>
              <span className="font-mono text-xs font-bold uppercase">Priority Conditions</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {["urgent", "high", "normal", "low"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePriority(p)}
                    className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                      formData.priorities.includes(p)
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {formData.priorities.length === 0 && (
                <p className="mt-1 font-mono text-xs text-zinc-400">No priority filter (matches all)</p>
              )}
            </div>

            {/* Targets */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">First Response Target (minutes)</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={formData.firstResponseMinutes}
                  onChange={(e) => setFormData({ ...formData, firstResponseMinutes: parseInt(e.target.value) || 60 })}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                />
                <span className="mt-1 block font-mono text-xs text-zinc-400">
                  = {formatMinutes(formData.firstResponseMinutes)}
                </span>
              </label>
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">Resolution Target (minutes)</span>
                <input
                  type="number"
                  min={1}
                  required
                  value={formData.resolutionMinutes}
                  onChange={(e) => setFormData({ ...formData, resolutionMinutes: parseInt(e.target.value) || 1440 })}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                />
                <span className="mt-1 block font-mono text-xs text-zinc-400">
                  = {formatMinutes(formData.resolutionMinutes)}
                </span>
              </label>
            </div>

            {/* Escalations */}
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase">Escalation Rules</span>
                <button
                  type="button"
                  onClick={addEscalation}
                  className="font-mono text-xs font-bold uppercase text-blue-600 hover:underline"
                >
                  + Add Escalation
                </button>
              </div>
              {formData.escalations.length === 0 && (
                <p className="mt-2 font-mono text-xs text-zinc-400">No escalation rules configured.</p>
              )}
              <div className="mt-2 space-y-2">
                {formData.escalations.map((esc, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 border border-zinc-200 p-3">
                    <span className="font-mono text-xs text-zinc-500">After</span>
                    <input
                      type="number"
                      min={1}
                      value={esc.afterMinutes}
                      onChange={(e) => updateEscalation(idx, "afterMinutes", parseInt(e.target.value) || 30)}
                      className="w-20 border-2 border-zinc-300 px-2 py-1 font-mono text-xs outline-none focus:border-zinc-950"
                    />
                    <span className="font-mono text-xs text-zinc-500">min:</span>
                    <select
                      value={esc.action}
                      onChange={(e) => updateEscalation(idx, "action", e.target.value)}
                      className="border-2 border-zinc-300 px-2 py-1 font-mono text-xs outline-none focus:border-zinc-950"
                    >
                      <option value="notify">Notify</option>
                      <option value="escalate">Escalate</option>
                      <option value="reassign">Reassign</option>
                    </select>
                    <input
                      type="text"
                      placeholder="to (optional)"
                      value={esc.to}
                      onChange={(e) => updateEscalation(idx, "to", e.target.value)}
                      className="flex-1 border-2 border-zinc-300 px-2 py-1 font-mono text-xs outline-none focus:border-zinc-950"
                    />
                    <button
                      type="button"
                      onClick={() => removeEscalation(idx)}
                      className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Creating..." : "Create Policy"}
            </button>
          </form>
        </section>
      )}

      {/* SLA CHECK */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Check Ticket SLA</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Enter ticket ID or external ID"
            value={checkTicketId}
            onChange={(e) => setCheckTicketId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCheck()}
            className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <button
            onClick={handleCheck}
            disabled={checking || !checkTicketId.trim()}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {checking ? "Checking..." : "Check SLA"}
          </button>
        </div>

        {checkError && (
          <div className="mt-4 border-2 border-red-300 bg-red-50 p-3">
            <p className="font-mono text-xs font-bold text-red-700">{checkError}</p>
          </div>
        )}

        {checkResults && checkResults.length === 0 && (
          <div className="mt-4 border border-zinc-200 p-3">
            <p className="font-mono text-xs text-zinc-500">No SLA policies match this ticket.</p>
          </div>
        )}

        {checkResults && checkResults.length > 0 && (
          <div className="mt-4 space-y-3">
            {checkResults.map((result) => (
              <div key={result.policyId} className="border-2 border-zinc-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold">{result.policyName}</span>
                  <div className="flex gap-2">
                    <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusBg[result.firstResponse.status]}`}>
                      FR: {result.firstResponse.status}
                    </span>
                    <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusBg[result.resolution.status]}`}>
                      RES: {result.resolution.status}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="font-mono text-xs text-zinc-500">First Response</p>
                    <p className="font-mono text-sm">
                      Target: {formatMinutes(result.firstResponse.targetMinutes)} |
                      Elapsed: {formatMinutes(result.firstResponse.elapsedMinutes)} |
                      Remaining: {formatMinutes(result.firstResponse.remainingMinutes)}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-zinc-500">Resolution</p>
                    <p className="font-mono text-sm">
                      Target: {formatMinutes(result.resolution.targetMinutes)} |
                      Elapsed: {formatMinutes(result.resolution.elapsedMinutes)} |
                      Remaining: {formatMinutes(result.resolution.remainingMinutes)}
                    </p>
                  </div>
                </div>
                {result.escalations.length > 0 && (
                  <div className="mt-3">
                    <p className="font-mono text-xs text-zinc-500">Escalations</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {result.escalations.map((esc, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                            esc.triggered
                              ? "bg-red-100 text-red-700 border border-red-300"
                              : "bg-zinc-100 text-zinc-500 border border-zinc-200"
                          }`}
                        >
                          {esc.action}{esc.to ? ` -> ${esc.to}` : ""} @ {formatMinutes(esc.afterMinutes)}
                          {esc.triggered ? " [TRIGGERED]" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* POLICIES LIST */}
      {loading ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading SLA policies...</p>
        </section>
      ) : policies.length > 0 ? (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 p-6">
            <h2 className="text-lg font-bold">Active Policies</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Policy</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Conditions</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">First Response</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Resolution</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Escalations</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr key={policy.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{policy.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {policy.conditions.priority?.map((p) => (
                          <span key={p} className="inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase bg-zinc-200 text-zinc-700">
                            {p}
                          </span>
                        ))}
                        {policy.conditions.tags?.map((t) => (
                          <span key={t} className="inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase border border-zinc-300 text-zinc-600">
                            {t}
                          </span>
                        ))}
                        {(!policy.conditions.priority?.length && !policy.conditions.tags?.length) && (
                          <span className="font-mono text-xs text-zinc-400">all tickets</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-bold">
                      {formatMinutes(policy.targets.firstResponse)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-bold">
                      {formatMinutes(policy.targets.resolution)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {policy.escalation.length} rule{policy.escalation.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-bold uppercase ${policy.enabled ? "text-emerald-600" : "text-zinc-400"}`}>
                        {policy.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No SLA policies found</p>
          <p className="mt-2 text-sm text-zinc-600">
            Create SLA policies to enforce response and resolution targets.
          </p>
        </section>
      )}

      {/* BREACH ALERTS */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100">
        <h2 className="text-lg font-bold text-white">SLA Breach Reference</h2>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-3">
            <span className="inline-block w-20 px-2 py-0.5 text-center font-mono text-xs font-bold uppercase bg-emerald-500 text-white">OK</span>
            <span className="font-mono text-sm text-zinc-300">Within SLA target. No action needed.</span>
          </div>
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-3">
            <span className="inline-block w-20 px-2 py-0.5 text-center font-mono text-xs font-bold uppercase bg-amber-400 text-black">Warning</span>
            <span className="font-mono text-sm text-zinc-300">75%+ of SLA time elapsed. Approaching breach.</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-block w-20 px-2 py-0.5 text-center font-mono text-xs font-bold uppercase bg-red-500 text-white">Breached</span>
            <span className="font-mono text-sm text-zinc-300">SLA target exceeded. Escalation triggered.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
