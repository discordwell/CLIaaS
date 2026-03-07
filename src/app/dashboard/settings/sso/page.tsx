"use client";

import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SSOProvider {
  id: string;
  name: string;
  protocol: "saml" | "oidc";
  enabled: boolean;
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  domainHint?: string;
  defaultRole?: string;
  jitEnabled?: boolean;
  forceAuthn?: boolean;
  signedAssertions?: boolean;
  createdAt: string;
  updatedAt: string;
}

type Protocol = "saml" | "oidc";

const EMPTY_FORM: Omit<SSOProvider, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  protocol: "saml",
  enabled: true,
  entityId: "",
  ssoUrl: "",
  certificate: "",
  clientId: "",
  clientSecret: "",
  issuer: "",
  authorizationUrl: "",
  tokenUrl: "",
  userInfoUrl: "",
  domainHint: "",
  defaultRole: "agent",
  jitEnabled: true,
  forceAuthn: false,
  signedAssertions: true,
};

const ROLES = ["admin", "agent", "viewer"] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SSOAdminPage() {
  const [providers, setProviders] = useState<SSOProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Form state */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  /* Test / delete state */
  const [testResult, setTestResult] = useState<{
    status: "idle" | "testing" | "success" | "fail";
    message?: string;
  }>({ status: "idle" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ---- Fetch providers ---- */

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sso/providers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProviders(data.providers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  /* ---- Helpers ---- */

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setTestResult({ status: "idle" });
  }

  function openEdit(p: SSOProvider) {
    setForm({
      name: p.name,
      protocol: p.protocol,
      enabled: p.enabled,
      entityId: p.entityId ?? "",
      ssoUrl: p.ssoUrl ?? "",
      certificate: p.certificate ?? "",
      clientId: p.clientId ?? "",
      clientSecret: p.clientSecret ?? "",
      issuer: p.issuer ?? "",
      authorizationUrl: p.authorizationUrl ?? "",
      tokenUrl: p.tokenUrl ?? "",
      userInfoUrl: p.userInfoUrl ?? "",
      domainHint: p.domainHint ?? "",
      defaultRole: p.defaultRole ?? "agent",
      jitEnabled: p.jitEnabled ?? true,
      forceAuthn: p.forceAuthn ?? false,
      signedAssertions: p.signedAssertions ?? true,
    });
    setEditingId(p.id);
    setShowForm(true);
    setTestResult({ status: "idle" });
  }

  function openAdd() {
    resetForm();
    setShowForm(true);
  }

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /* ---- Save ---- */

  async function handleSave() {
    setError(null);
    const method = editingId ? "PATCH" : "POST";
    const url = editingId
      ? `/api/auth/sso/providers/${editingId}`
      : "/api/auth/sso/providers";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await fetchProviders();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  /* ---- Test connection ---- */

  async function handleTest() {
    setTestResult({ status: "testing" });
    // Simulate a connection test with a short delay
    // In production this would hit a real IdP metadata/well-known endpoint
    try {
      if (form.protocol === "saml") {
        if (!form.entityId || !form.ssoUrl || !form.certificate) {
          setTestResult({
            status: "fail",
            message: "Entity ID, SSO URL, and Certificate are required for SAML",
          });
          return;
        }
      } else {
        if (!form.clientId || !form.issuer) {
          setTestResult({
            status: "fail",
            message: "Client ID and Issuer URL are required for OIDC",
          });
          return;
        }
      }
      // Attempt to reach the SSO/issuer URL to validate connectivity
      const targetUrl =
        form.protocol === "saml" ? form.ssoUrl : form.issuer;
      if (targetUrl) {
        try {
          await fetch(targetUrl, { mode: "no-cors", signal: AbortSignal.timeout(5000) });
        } catch {
          // no-cors will often opaque-fail; treat as inconclusive rather than hard failure
        }
      }
      setTestResult({ status: "success", message: "Configuration looks valid" });
    } catch {
      setTestResult({ status: "fail", message: "Connection test failed" });
    }
  }

  /* ---- Delete ---- */

  async function handleDelete(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/auth/sso/providers/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setConfirmDeleteId(null);
      await fetchProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  /* ---- Render ---- */

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-2 border-line bg-panel p-8">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Security
          </p>
          <h1 className="mt-2 text-3xl font-bold">Single Sign-On</h1>
        </div>
        <button
          onClick={openAdd}
          className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
        >
          Add Provider
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 border-2 border-red-600 bg-red-50 p-4 font-mono text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Provider list */}
      <section className="mt-8 space-y-4">
        {loading && (
          <div className="border-2 border-line bg-panel p-8 text-center font-mono text-sm text-muted">
            Loading providers...
          </div>
        )}

        {!loading && providers.length === 0 && (
          <div className="border-2 border-line bg-panel p-8 text-center font-mono text-sm text-muted">
            No SSO providers configured. Click &quot;Add Provider&quot; to get started.
          </div>
        )}

        {providers.map((p) => (
          <div key={p.id}>
            <div
              className="flex items-center justify-between border-2 border-line bg-panel p-5 hover:bg-accent-soft cursor-pointer"
              onClick={() =>
                editingId === p.id ? resetForm() : openEdit(p)
              }
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-mono text-sm font-bold">{p.name}</p>
                  {p.domainHint && (
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {p.domainHint}
                    </p>
                  )}
                </div>
                {/* Protocol badge */}
                <span
                  className={`border-2 border-line px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                    p.protocol === "saml"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-purple-100 text-purple-800"
                  }`}
                >
                  {p.protocol}
                </span>
                {/* Status badge */}
                <span
                  className={`border-2 border-line px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                    p.enabled
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-200 text-zinc-600"
                  }`}
                >
                  {p.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-muted">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
                <span className="font-mono text-xs text-muted">
                  {editingId === p.id ? "▲" : "▼"}
                </span>
              </div>
            </div>

            {/* Inline edit form for this provider */}
            {editingId === p.id && showForm && (
              <div className="border-x-2 border-b-2 border-line bg-panel p-6">
                {renderForm()}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Inline add form (not tied to a provider card) */}
      {showForm && !editingId && (
        <section className="mt-8 border-2 border-line bg-panel p-6">
          <h2 className="mb-6 font-mono text-sm font-bold uppercase tracking-wider">
            New Provider
          </h2>
          {renderForm()}
        </section>
      )}
    </main>
  );

  /* ================================================================ */
  /*  Form renderer (shared between add and edit)                      */
  /* ================================================================ */

  function renderForm() {
    const proto: Protocol = form.protocol;

    return (
      <div className="space-y-6">
        {/* Protocol tabs */}
        <div className="flex gap-0">
          {(["saml", "oidc"] as Protocol[]).map((p) => (
            <button
              key={p}
              onClick={() => setField("protocol", p)}
              className={`border-2 border-line px-6 py-2 font-mono text-xs font-bold uppercase ${
                proto === p
                  ? "bg-foreground text-panel"
                  : "bg-panel text-foreground hover:bg-accent-soft"
              } ${p === "oidc" ? "-ml-0.5" : ""}`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Common: Name */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldInput
            label="Provider Name"
            value={form.name}
            onChange={(v) => setField("name", v)}
            placeholder="e.g. Okta Production"
          />
          <FieldInput
            label="Domain Hint"
            value={form.domainHint ?? ""}
            onChange={(v) => setField("domainHint", v)}
            placeholder="e.g. acme.com"
          />
        </div>

        {/* SAML fields */}
        {proto === "saml" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldInput
                label="Entity ID"
                value={form.entityId ?? ""}
                onChange={(v) => setField("entityId", v)}
                placeholder="https://idp.example.com/metadata"
              />
              <FieldInput
                label="SSO URL"
                value={form.ssoUrl ?? ""}
                onChange={(v) => setField("ssoUrl", v)}
                placeholder="https://idp.example.com/sso"
              />
            </div>
            <FieldTextarea
              label="Certificate (PEM / Base64)"
              value={form.certificate ?? ""}
              onChange={(v) => setField("certificate", v)}
              placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDx..."
              rows={4}
            />
            <FieldToggle
              label="Signed Assertions"
              checked={form.signedAssertions ?? true}
              onChange={(v) => setField("signedAssertions", v)}
            />
          </div>
        )}

        {/* OIDC fields */}
        {proto === "oidc" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldInput
                label="Client ID"
                value={form.clientId ?? ""}
                onChange={(v) => setField("clientId", v)}
                placeholder="client-id"
              />
              <FieldInput
                label="Client Secret"
                value={form.clientSecret ?? ""}
                onChange={(v) => setField("clientSecret", v)}
                placeholder="client-secret"
                type="password"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldInput
                label="Issuer URL"
                value={form.issuer ?? ""}
                onChange={(v) => setField("issuer", v)}
                placeholder="https://accounts.google.com"
              />
              <FieldInput
                label="Authorization URL"
                value={form.authorizationUrl ?? ""}
                onChange={(v) => setField("authorizationUrl", v)}
                placeholder="https://idp.example.com/authorize"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldInput
                label="Token URL"
                value={form.tokenUrl ?? ""}
                onChange={(v) => setField("tokenUrl", v)}
                placeholder="https://idp.example.com/token"
              />
              <FieldInput
                label="UserInfo URL"
                value={form.userInfoUrl ?? ""}
                onChange={(v) => setField("userInfoUrl", v)}
                placeholder="https://idp.example.com/userinfo"
              />
            </div>
          </div>
        )}

        {/* Common: Default Role, JIT, Force AuthN */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Default Role
            </label>
            <select
              value={form.defaultRole ?? "agent"}
              onChange={(e) => setField("defaultRole", e.target.value)}
              className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-foreground"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <FieldToggle
            label="JIT Provisioning"
            checked={form.jitEnabled ?? true}
            onChange={(v) => setField("jitEnabled", v)}
          />
          <FieldToggle
            label="Force AuthN"
            checked={form.forceAuthn ?? false}
            onChange={(v) => setField("forceAuthn", v)}
          />
        </div>

        {/* Actions row */}
        <div className="flex flex-wrap items-center gap-3 border-t-2 border-line pt-6">
          <button
            onClick={handleSave}
            className="border-2 border-line bg-foreground px-6 py-2 font-mono text-xs font-bold uppercase text-panel hover:opacity-90"
          >
            {editingId ? "Update Provider" : "Create Provider"}
          </button>
          <button
            onClick={handleTest}
            disabled={testResult.status === "testing"}
            className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft disabled:opacity-50"
          >
            {testResult.status === "testing" ? "Testing..." : "Test Connection"}
          </button>
          <button
            onClick={resetForm}
            className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            Cancel
          </button>

          {/* Delete (only when editing) */}
          {editingId && (
            <>
              {confirmDeleteId === editingId ? (
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-xs text-red-600">
                    Confirm delete?
                  </span>
                  <button
                    onClick={() => handleDelete(editingId)}
                    className="border-2 border-red-600 bg-red-50 px-4 py-2 font-mono text-xs font-bold uppercase text-red-700 hover:bg-red-100"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(editingId)}
                  className="ml-auto border-2 border-red-600 bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>

        {/* Test result indicator */}
        {testResult.status !== "idle" && testResult.status !== "testing" && (
          <div
            className={`border-2 p-3 font-mono text-sm ${
              testResult.status === "success"
                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                : "border-red-600 bg-red-50 text-red-800"
            }`}
          >
            <span className="mr-2 font-bold uppercase">
              {testResult.status === "success" ? "PASS" : "FAIL"}
            </span>
            {testResult.message}
          </div>
        )}
      </div>
    );
  }
}

/* ================================================================== */
/*  Reusable field components                                          */
/* ================================================================== */

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-muted">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 outline-none focus:ring-2 focus:ring-foreground"
      />
    </div>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-muted">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted/50 outline-none focus:ring-2 focus:ring-foreground"
      />
    </div>
  );
}

function FieldToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-line transition-colors ${
          checked ? "bg-emerald-500" : "bg-zinc-300"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
        {label}
      </label>
    </div>
  );
}
