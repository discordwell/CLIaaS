"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Shared types (mirroring lib interfaces) ----

interface Brand {
  id: string;
  name: string;
  subdomain: string;
  logo: string;
  primaryColor: string;
  portalTitle: string;
  kbEnabled: boolean;
  chatEnabled: boolean;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string;
}

interface RetentionPolicy {
  id: string;
  resource: string;
  retentionDays: number;
  action: string;
  createdAt: string;
}

interface CustomField {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  options: string[];
  conditions: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
}

interface CustomForm {
  id: string;
  name: string;
  fields: string[];
  ticketType: string;
  createdAt: string;
}

interface TimeEntry {
  id: string;
  ticketId: string;
  userId: string;
  userName: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  billable: boolean;
  notes: string;
}

interface TimeReport {
  totalMinutes: number;
  billableMinutes: number;
  byAgent: Array<{
    userId: string;
    userName: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byTicket: Array<{
    ticketId: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
  byDay: Array<{
    date: string;
    totalMinutes: number;
    billableMinutes: number;
  }>;
}

interface SandboxConfig {
  id: string;
  name: string;
  createdAt: string;
  sourceWorkspaceId: string;
  status: string;
  promotedAt?: string;
}

// ---- Tab definitions ----

type Tab = "brands" | "audit" | "compliance" | "fields" | "time" | "sandbox";

const TABS: { key: Tab; label: string }[] = [
  { key: "brands", label: "Brands" },
  { key: "audit", label: "Audit Log" },
  { key: "compliance", label: "Compliance" },
  { key: "fields", label: "Custom Fields" },
  { key: "time", label: "Time Tracking" },
  { key: "sandbox", label: "Sandbox" },
];

// ---- Helpers ----

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${h}h ${mins}m` : `${h}h`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const fieldTypeColors: Record<string, string> = {
  text: "bg-blue-500 text-white",
  number: "bg-emerald-500 text-white",
  select: "bg-amber-400 text-black",
  checkbox: "bg-purple-500 text-white",
  date: "bg-red-500 text-white",
};

// ======================== MAIN COMPONENT ========================

export default function EnterprisePage() {
  const [tab, setTab] = useState<Tab>("brands");

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Phase 6
            </p>
            <h1 className="mt-2 text-3xl font-bold">Enterprise Settings</h1>
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
        {tab === "brands" && <BrandsTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "compliance" && <ComplianceTab />}
        {tab === "fields" && <CustomFieldsTab />}
        {tab === "time" && <TimeTrackingTab />}
        {tab === "sandbox" && <SandboxTab />}
      </div>
    </main>
  );
}

// ======================== BRANDS TAB ========================

function BrandsTab() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    subdomain: "",
    primaryColor: "#09090b",
    portalTitle: "",
    kbEnabled: true,
    chatEnabled: false,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/brands");
      const data = await res.json();
      setBrands(data.brands || []);
    } catch {
      setBrands([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({ name: "", subdomain: "", primaryColor: "#09090b", portalTitle: "", kbEnabled: true, chatEnabled: false });
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/brands/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <LoadingBlock label="Loading brands..." />;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{brands.length} Brand{brands.length !== 1 ? "s" : ""}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showForm ? "Cancel" : "New Brand"}
        </button>
      </div>

      {showForm && (
        <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Brand</h3>
          <form onSubmit={handleCreate} className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormInput label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="My Brand" />
            <FormInput label="Subdomain" required value={form.subdomain} onChange={(v) => setForm({ ...form, subdomain: v })} placeholder="mybrand" />
            <FormInput label="Primary Color" value={form.primaryColor} onChange={(v) => setForm({ ...form, primaryColor: v })} placeholder="#09090b" />
            <FormInput label="Portal Title" value={form.portalTitle} onChange={(v) => setForm({ ...form, portalTitle: v })} placeholder="Help Center" />
            <label className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <input type="checkbox" checked={form.kbEnabled} onChange={(e) => setForm({ ...form, kbEnabled: e.target.checked })} />
              KB Enabled
            </label>
            <label className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <input type="checkbox" checked={form.chatEnabled} onChange={(e) => setForm({ ...form, chatEnabled: e.target.checked })} />
              Chat Enabled
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
                {saving ? "Creating..." : "Create Brand"}
              </button>
            </div>
          </form>
        </section>
      )}

      {brands.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Color</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Subdomain</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Portal Title</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Features</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500"></th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="h-6 w-6 border border-zinc-300" style={{ backgroundColor: b.primaryColor }} />
                    </td>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{b.subdomain}</td>
                    <td className="px-4 py-3 text-zinc-600">{b.portalTitle}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {b.kbEnabled && <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs">KB</span>}
                        {b.chatEnabled && <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs">Chat</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(b.id)} className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock message="No brands configured" sub="Create a brand to enable multi-brand support." />
      )}
    </>
  );
}

// ======================== AUDIT TAB ========================

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set("action", actionFilter);
      if (resourceFilter) params.set("resource", resourceFilter);
      params.set("limit", "50");
      const res = await fetch(`/api/audit?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total ?? 0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function handleExport(format: "csv" | "json") {
    const params = new URLSearchParams();
    params.set("format", format);
    if (actionFilter) params.set("action", actionFilter);
    if (resourceFilter) params.set("resource", resourceFilter);
    window.open(`/api/audit/export?${params}`, "_blank");
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-bold">{total} Audit Entr{total !== 1 ? "ies" : "y"}</h2>
        <div className="flex gap-2">
          <button onClick={() => handleExport("csv")} className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800">
            Export CSV
          </button>
          <button onClick={() => handleExport("json")} className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100">
            Export JSON
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-4">
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-500">Action</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="">All actions</option>
            {["ticket.create", "ticket.update", "ticket.assign", "ticket.close", "rule.create", "rule.update", "user.login", "user.logout", "settings.change"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-500">Resource</span>
          <select
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
            className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="">All resources</option>
            {["ticket", "rule", "session", "settings"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingBlock label="Loading audit log..." />
      ) : entries.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Time</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">User</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Action</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Resource</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Details</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{shortDate(e.timestamp)}</td>
                    <td className="px-4 py-3 font-medium">{e.userName}</td>
                    <td className="px-4 py-3">
                      <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs font-bold">{e.action}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{e.resource}/{e.resourceId}</td>
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-500">
                      {Object.entries(e.details).map(([k, v]) => `${k}=${String(v)}`).join(", ") || "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{e.ipAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock message="No audit entries found" sub="Actions will appear here as they occur." />
      )}
    </>
  );
}

// ======================== COMPLIANCE TAB ========================

function ComplianceTab() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportUserId, setExportUserId] = useState("");
  const [deleteUserId, setDeleteUserId] = useState("");
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRetentionForm, setShowRetentionForm] = useState(false);
  const [retForm, setRetForm] = useState({ resource: "tickets", retentionDays: "365", action: "archive" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/retention");
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExportData(e: React.FormEvent) {
    e.preventDefault();
    setExportResult(null);
    try {
      const res = await fetch("/api/compliance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: exportUserId }),
      });
      const data = await res.json();
      setExportResult(`Exported ${data.tickets?.length ?? 0} tickets and ${data.messages?.length ?? 0} messages for user "${exportUserId}"`);
    } catch {
      setExportResult("Export failed");
    }
  }

  async function handleDeleteData() {
    setDeleteResult(null);
    try {
      const res = await fetch("/api/compliance/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: deleteUserId }),
      });
      const data = await res.json();
      setDeleteResult(`Anonymized ${data.anonymizedTickets ?? 0} tickets and ${data.anonymizedMessages ?? 0} messages for user "${deleteUserId}"`);
      setConfirmDelete(false);
      setDeleteUserId("");
    } catch {
      setDeleteResult("Deletion failed");
    }
  }

  async function handleCreateRetention(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/compliance/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retForm),
      });
      setShowRetentionForm(false);
      setRetForm({ resource: "tickets", retentionDays: "365", action: "archive" });
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* GDPR Export */}
      <section className="border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">GDPR Data Export</h3>
        <form onSubmit={handleExportData} className="mt-4 flex flex-wrap gap-4">
          <label className="block flex-1">
            <span className="font-mono text-xs font-bold uppercase">User ID / Email</span>
            <input
              type="text"
              required
              value={exportUserId}
              onChange={(e) => setExportUserId(e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              placeholder="user@example.com"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800">
              Export Data
            </button>
          </div>
        </form>
        {exportResult && (
          <p className="mt-3 bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-700">{exportResult}</p>
        )}
      </section>

      {/* GDPR Delete */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">GDPR Right to Erasure</h3>
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="block flex-1">
            <span className="font-mono text-xs font-bold uppercase">User ID / Email</span>
            <input
              type="text"
              value={deleteUserId}
              onChange={(e) => { setDeleteUserId(e.target.value); setConfirmDelete(false); }}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              placeholder="user@example.com"
            />
          </label>
          <div className="flex items-end gap-2">
            {!confirmDelete ? (
              <button
                onClick={() => deleteUserId && setConfirmDelete(true)}
                disabled={!deleteUserId}
                className="border-2 border-red-500 bg-white px-4 py-2 font-mono text-xs font-bold uppercase text-red-500 hover:bg-red-50 disabled:opacity-50"
              >
                Delete Data
              </button>
            ) : (
              <>
                <button
                  onClick={handleDeleteData}
                  className="border-2 border-red-500 bg-red-500 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-red-600"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="border-2 border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
        {deleteResult && (
          <p className="mt-3 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">{deleteResult}</p>
        )}
      </section>

      {/* Retention Policies */}
      <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Retention Policies</h3>
          <button
            onClick={() => setShowRetentionForm(!showRetentionForm)}
            className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showRetentionForm ? "Cancel" : "Add Policy"}
          </button>
        </div>

        {showRetentionForm && (
          <form onSubmit={handleCreateRetention} className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Resource</span>
              <select
                value={retForm.resource}
                onChange={(e) => setRetForm({ ...retForm, resource: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {["tickets", "messages", "audit_logs", "attachments"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Retention Days</span>
              <input
                type="number"
                required
                min={1}
                value={retForm.retentionDays}
                onChange={(e) => setRetForm({ ...retForm, retentionDays: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Action</span>
              <select
                value={retForm.action}
                onChange={(e) => setRetForm({ ...retForm, action: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                <option value="archive">Archive</option>
                <option value="delete">Delete</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <button type="submit" disabled={saving} className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
                {saving ? "Creating..." : "Create Policy"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="mt-4 font-mono text-sm text-zinc-500">Loading...</p>
        ) : policies.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Resource</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Retention</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Action</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{p.resource}</td>
                    <td className="px-4 py-3 font-mono text-sm">{p.retentionDays} days</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${p.action === "delete" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                        {p.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{shortDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">No retention policies configured.</p>
        )}
      </section>
    </>
  );
}

// ======================== CUSTOM FIELDS TAB ========================

function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [fieldForm, setFieldForm] = useState({
    name: "",
    key: "",
    type: "text" as string,
    required: false,
    options: "",
    sortOrder: "0",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [fRes, formRes] = await Promise.all([
        fetch("/api/custom-fields"),
        fetch("/api/custom-forms"),
      ]);
      const fData = await fRes.json();
      const formData = await formRes.json();
      setFields(fData.fields || []);
      setForms(formData.forms || []);
    } catch {
      setFields([]);
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateField(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fieldForm.name,
          key: fieldForm.key,
          type: fieldForm.type,
          required: fieldForm.required,
          options: fieldForm.type === "select" ? fieldForm.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
          sortOrder: parseInt(fieldForm.sortOrder, 10) || 0,
        }),
      });
      setShowFieldForm(false);
      setFieldForm({ name: "", key: "", type: "text", required: false, options: "", sortOrder: "0" });
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteField(id: string) {
    await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <LoadingBlock label="Loading custom fields..." />;

  return (
    <>
      {/* Fields */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{fields.length} Field{fields.length !== 1 ? "s" : ""}</h2>
        <button
          onClick={() => setShowFieldForm(!showFieldForm)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showFieldForm ? "Cancel" : "New Field"}
        </button>
      </div>

      {showFieldForm && (
        <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Field</h3>
          <form onSubmit={handleCreateField} className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormInput label="Name" required value={fieldForm.name} onChange={(v) => setFieldForm({ ...fieldForm, name: v })} placeholder="Environment" />
            <FormInput label="Key" required value={fieldForm.key} onChange={(v) => setFieldForm({ ...fieldForm, key: v })} placeholder="environment" />
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Type</span>
              <select
                value={fieldForm.type}
                onChange={(e) => setFieldForm({ ...fieldForm, type: e.target.value })}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {["text", "number", "select", "checkbox", "date"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <input type="checkbox" checked={fieldForm.required} onChange={(e) => setFieldForm({ ...fieldForm, required: e.target.checked })} />
              Required
            </label>
            {fieldForm.type === "select" && (
              <div className="sm:col-span-2">
                <FormInput label="Options (comma-separated)" value={fieldForm.options} onChange={(v) => setFieldForm({ ...fieldForm, options: v })} placeholder="option1, option2, option3" />
              </div>
            )}
            <FormInput label="Sort Order" value={fieldForm.sortOrder} onChange={(v) => setFieldForm({ ...fieldForm, sortOrder: v })} placeholder="0" />
            <div className="flex items-end">
              <button type="submit" disabled={saving} className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
                {saving ? "Creating..." : "Create Field"}
              </button>
            </div>
          </form>
        </section>
      )}

      {fields.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Type</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Key</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Required</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Options</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${fieldTypeColors[f.type] ?? "bg-zinc-200"}`}>
                        {f.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{f.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{f.key}</td>
                    <td className="px-4 py-3 font-mono text-xs">{f.required ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {f.options.length > 0 ? f.options.join(", ") : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDeleteField(f.id)} className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock message="No custom fields" sub="Create fields to extend ticket data." />
      )}

      {/* Forms */}
      {forms.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Custom Forms</h3>
          <div className="mt-4 space-y-3">
            {forms.map((form) => (
              <div key={form.id} className="flex items-center justify-between border border-zinc-200 px-4 py-3">
                <div>
                  <span className="font-medium">{form.name}</span>
                  {form.ticketType && (
                    <span className="ml-2 bg-zinc-200 px-2 py-0.5 font-mono text-xs">{form.ticketType}</span>
                  )}
                </div>
                <span className="font-mono text-xs text-zinc-500">{form.fields.length} field{form.fields.length !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ======================== TIME TRACKING TAB ========================

function TimeTrackingTab() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [timers, setTimers] = useState<TimeEntry[]>([]);
  const [report, setReport] = useState<TimeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    ticketId: "",
    userId: "user-1",
    userName: "Alice Chen",
    durationMinutes: "30",
    billable: true,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [entryRes, timerRes, reportRes] = await Promise.all([
        fetch("/api/time"),
        fetch("/api/time/timer"),
        fetch("/api/time/report"),
      ]);
      const entryData = await entryRes.json();
      const timerData = await timerRes.json();
      const reportData = await reportRes.json();
      setEntries(entryData.entries || []);
      setTimers(timerData.timers || []);
      setReport(reportData);
    } catch {
      setEntries([]);
      setTimers([]);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLogManual(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualForm),
      });
      setShowManualForm(false);
      setManualForm({ ticketId: "", userId: "user-1", userName: "Alice Chen", durationMinutes: "30", billable: true, notes: "" });
      load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock label="Loading time tracking..." />;

  return (
    <>
      {/* Active Timers */}
      <section className="border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Active Timers</h3>
        {timers.length > 0 ? (
          <div className="mt-4 space-y-3">
            {timers.map((t) => (
              <div key={t.id} className="flex items-center justify-between border border-zinc-200 px-4 py-3">
                <div>
                  <span className="font-medium">{t.userName}</span>
                  <span className="ml-2 font-mono text-xs text-zinc-500">on {t.ticketId}</span>
                </div>
                <span className="font-mono text-xs text-emerald-600">Running since {shortDate(t.startTime)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">No active timers.</p>
        )}
      </section>

      {/* Log Manual Time */}
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-lg font-bold">{entries.length} Time Entr{entries.length !== 1 ? "ies" : "y"}</h3>
        <button
          onClick={() => setShowManualForm(!showManualForm)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showManualForm ? "Cancel" : "Log Time"}
        </button>
      </div>

      {showManualForm && (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Log Manual Time</h3>
          <form onSubmit={handleLogManual} className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormInput label="Ticket ID" required value={manualForm.ticketId} onChange={(v) => setManualForm({ ...manualForm, ticketId: v })} placeholder="tkt-101" />
            <FormInput label="Duration (minutes)" required value={manualForm.durationMinutes} onChange={(v) => setManualForm({ ...manualForm, durationMinutes: v })} placeholder="30" />
            <FormInput label="Agent Name" required value={manualForm.userName} onChange={(v) => setManualForm({ ...manualForm, userName: v })} placeholder="Alice Chen" />
            <label className="flex items-center gap-2 font-mono text-xs font-bold uppercase">
              <input type="checkbox" checked={manualForm.billable} onChange={(e) => setManualForm({ ...manualForm, billable: e.target.checked })} />
              Billable
            </label>
            <div className="sm:col-span-2">
              <FormInput label="Notes" value={manualForm.notes} onChange={(v) => setManualForm({ ...manualForm, notes: v })} placeholder="What was done..." />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
                {saving ? "Logging..." : "Log Time"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Report Summary */}
      {report && (
        <section className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">Total Time</p>
            <p className="mt-2 text-3xl font-bold">{formatMinutes(report.totalMinutes)}</p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">Billable Time</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">{formatMinutes(report.billableMinutes)}</p>
          </div>
          <div className="border-2 border-zinc-950 bg-white p-6">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">Agents</p>
            <p className="mt-2 text-3xl font-bold">{report.byAgent.length}</p>
          </div>
        </section>
      )}

      {/* Per-Agent Breakdown */}
      {report && report.byAgent.length > 0 && (
        <section className="mt-4 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 p-6">
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Per-Agent Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Total</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Billable</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Load</th>
                </tr>
              </thead>
              <tbody>
                {report.byAgent.map((agent) => {
                  const maxMinutes = Math.max(...report.byAgent.map((a) => a.totalMinutes), 1);
                  return (
                    <tr key={agent.userId} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium">{agent.userName}</td>
                      <td className="px-4 py-3 font-mono text-sm">{formatMinutes(agent.totalMinutes)}</td>
                      <td className="px-4 py-3 font-mono text-sm text-emerald-600">{formatMinutes(agent.billableMinutes)}</td>
                      <td className="px-4 py-3">
                        <div className="h-2 w-24 bg-zinc-200">
                          <div className="h-full bg-zinc-950" style={{ width: `${(agent.totalMinutes / maxMinutes) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent entries */}
      {entries.length > 0 && (
        <section className="mt-4 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 p-6">
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Recent Entries</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Ticket</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Duration</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Billable</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Notes</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 20).map((e) => (
                  <tr key={e.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{e.userName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.ticketId}</td>
                    <td className="px-4 py-3 font-mono text-sm font-bold">{formatMinutes(e.durationMinutes)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-bold ${e.billable ? "text-emerald-600" : "text-zinc-400"}`}>
                        {e.billable ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-zinc-600">{e.notes || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{shortDate(e.startTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// ======================== SANDBOX TAB ========================

function SandboxTab() {
  const [sandboxes, setSandboxes] = useState<SandboxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox");
      const data = await res.json();
      setSandboxes(data.sandboxes || []);
    } catch {
      setSandboxes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setShowForm(false);
      setName("");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handlePromote(id: string) {
    await fetch(`/api/sandbox/${id}/promote`, { method: "POST" });
    load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sandbox/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <LoadingBlock label="Loading sandboxes..." />;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{sandboxes.length} Sandbox{sandboxes.length !== 1 ? "es" : ""}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showForm ? "Cancel" : "New Sandbox"}
        </button>
      </div>

      {showForm && (
        <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">Create Sandbox</h3>
          <form onSubmit={handleCreate} className="mt-4 flex gap-4">
            <label className="block flex-1">
              <span className="font-mono text-xs font-bold uppercase">Name</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Dev Testing"
              />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={saving} className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50">
                {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </section>
      )}

      {sandboxes.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Name</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Source</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Created</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500"></th>
                </tr>
              </thead>
              <tbody>
                {sandboxes.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        s.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"
                      }`}>
                        {s.status}
                      </span>
                      {s.promotedAt && (
                        <span className="ml-2 font-mono text-xs text-zinc-400">promoted {shortDate(s.promotedAt)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{s.sourceWorkspaceId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{shortDate(s.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        {s.status === "active" && (
                          <button onClick={() => handlePromote(s.id)} className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800">
                            Promote
                          </button>
                        )}
                        <button onClick={() => handleDelete(s.id)} className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock message="No sandboxes" sub="Create a sandbox to test configuration changes safely." />
      )}
    </>
  );
}

// ======================== SHARED SUB-COMPONENTS ========================

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs font-bold uppercase">{label}</span>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
        placeholder={placeholder}
      />
    </label>
  );
}

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
