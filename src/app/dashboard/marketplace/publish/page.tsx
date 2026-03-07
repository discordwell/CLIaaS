"use client";

import { useState } from "react";
import Link from "next/link";

/* ---------- Types ---------- */

interface ManifestData {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: string[];
  permissions: string[];
  actions: { id: string; name: string; description: string }[];
  uiSlots: { location: string; component: string }[];
  oauthRequirements: { provider: string; scopes: string[] }[];
  configSchema?: Record<string, unknown>;
  entrypoint?: string;
  webhookUrl?: string;
  runtime: string;
  icon?: string;
  category?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface DetailsData {
  name: string;
  description: string;
  category: string;
  iconPlaceholder: string;
  screenshotsPlaceholder: string;
}

/* ---------- Constants ---------- */

const VALID_HOOKS = [
  "ticket.created", "ticket.updated", "ticket.resolved", "ticket.deleted",
  "ticket.assigned", "ticket.tagged", "ticket.priority_changed", "ticket.merged",
  "ticket.split", "ticket.unmerged", "message.created", "message.updated",
  "message.displayed", "message.clicked", "message.dismissed",
  "sla.breached", "sla.warning", "customer.created", "customer.updated",
  "customer.merged", "csat.submitted", "survey.submitted", "survey.sent",
  "kb.article_created", "kb.article_updated", "campaign.created", "campaign.sent",
  "campaign.activated", "campaign.paused", "campaign.step_executed",
  "campaign.enrollment_completed", "automation.executed",
  "forum.thread_created", "forum.reply_created", "forum.thread_converted",
  "qa.review_created", "qa.review_completed", "time.entry_created",
  "side_conversation.created", "side_conversation.replied",
  "tour.started", "tour.completed", "tour.dismissed",
  "plugin.installed", "plugin.uninstalled", "plugin.enabled",
  "plugin.disabled", "plugin.configured",
];

const VALID_PERMISSIONS = [
  "tickets:read", "tickets:write", "customers:read", "customers:write",
  "kb:read", "kb:write", "messages:read", "messages:write",
  "analytics:read", "webhooks:manage", "oauth:external",
];

const CATEGORIES = [
  "Productivity",
  "Communication",
  "Analytics",
  "Automation",
  "Security",
  "Integration",
  "Customer Success",
  "Developer Tools",
  "Other",
];

/* ---------- Step Indicator ---------- */

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = ["Manifest", "Details", "Validation", "Submit"];
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, idx) => {
        const step = idx + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        return (
          <div key={label} className="flex items-center">
            {idx > 0 && (
              <div
                className={`h-0.5 w-8 ${
                  isCompleted ? "bg-foreground" : "bg-line"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center border-2 font-mono text-xs font-bold ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : isCompleted
                      ? "border-foreground bg-foreground text-background"
                      : "border-line bg-panel text-muted"
                }`}
              >
                {isCompleted ? "\u2713" : step}
              </div>
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                  isActive ? "text-foreground" : "text-muted"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Step 1: Manifest ---------- */

function ManifestStep({
  manifestJson,
  setManifestJson,
  parseError,
  onParse,
}: {
  manifestJson: string;
  setManifestJson: (v: string) => void;
  parseError: string | null;
  onParse: () => void;
}) {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") {
        setManifestJson(text);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Upload Manifest
        </p>
        <label className="mt-3 flex cursor-pointer items-center gap-3">
          <span className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft">
            Choose File
          </span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <span className="font-mono text-xs text-muted">
            JSON manifest file
          </span>
        </label>
      </div>

      <div>
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Or Paste Manifest JSON
        </p>
        <textarea
          value={manifestJson}
          onChange={(e) => setManifestJson(e.target.value)}
          rows={18}
          placeholder={`{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A plugin that does something useful",
  "author": "Your Name",
  "hooks": ["ticket.created"],
  "permissions": ["tickets:read"],
  "actions": [],
  "uiSlots": [],
  "oauthRequirements": [],
  "runtime": "webhook"
}`}
          className="mt-3 w-full border-2 border-line bg-background px-4 py-3 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      {parseError && (
        <div className="border-2 border-red-500 bg-red-50 p-3 font-mono text-xs text-red-700">
          {parseError}
        </div>
      )}

      <button
        onClick={onParse}
        disabled={!manifestJson.trim()}
        className="border-2 border-line bg-foreground px-6 py-2.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Parse &amp; Continue
      </button>
    </div>
  );
}

/* ---------- Step 2: Details ---------- */

function DetailsStep({
  details,
  setDetails,
  manifest,
  onNext,
  onBack,
}: {
  details: DetailsData;
  setDetails: (d: DetailsData) => void;
  manifest: ManifestData;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Plugin Name
        </label>
        <input
          type="text"
          value={details.name}
          onChange={(e) => setDetails({ ...details, name: e.target.value })}
          className="mt-2 w-full border-2 border-line bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      <div>
        <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Description
        </label>
        <textarea
          value={details.description}
          onChange={(e) => setDetails({ ...details, description: e.target.value })}
          rows={4}
          className="mt-2 w-full border-2 border-line bg-background px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      <div>
        <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Category
        </label>
        <select
          value={details.category}
          onChange={(e) => setDetails({ ...details, category: e.target.value })}
          className="mt-2 w-full border-2 border-line bg-background px-4 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
        >
          <option value="">Select a category</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Plugin Icon
        </label>
        <div className="mt-2 flex h-24 w-24 items-center justify-center border-2 border-dashed border-line bg-background font-mono text-xs text-muted">
          {details.iconPlaceholder || "64x64"}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted">
          Icon upload coming soon. Use manifest icon URL for now.
        </p>
      </div>

      <div>
        <label className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Screenshots
        </label>
        <div className="mt-2 flex gap-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex h-20 w-32 items-center justify-center border-2 border-dashed border-line bg-background font-mono text-xs text-muted"
            >
              {n}
            </div>
          ))}
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted">
          Screenshot upload coming soon.
        </p>
      </div>

      {/* Manifest Summary */}
      <div className="border-2 border-line bg-background p-4">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
          Manifest Summary
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs">
          <div>
            <span className="text-muted">ID:</span>{" "}
            <span className="font-bold text-foreground">{manifest.id}</span>
          </div>
          <div>
            <span className="text-muted">Version:</span>{" "}
            <span className="font-bold text-foreground">{manifest.version}</span>
          </div>
          <div>
            <span className="text-muted">Runtime:</span>{" "}
            <span className="font-bold text-foreground">{manifest.runtime}</span>
          </div>
          <div>
            <span className="text-muted">Hooks:</span>{" "}
            <span className="font-bold text-foreground">{manifest.hooks.length}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="border-2 border-line bg-panel px-6 py-2.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!details.name.trim() || !details.category}
          className="border-2 border-line bg-foreground px-6 py-2.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Validate
        </button>
      </div>
    </div>
  );
}

/* ---------- Step 3: Validation ---------- */

function ValidationStep({
  validation,
  onNext,
  onBack,
}: {
  validation: ValidationResult;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <div className="flex items-center gap-3">
        <span
          className={`border-2 border-line px-3 py-1 font-mono text-xs font-bold uppercase ${
            validation.valid
              ? "bg-emerald-400 text-black"
              : "bg-red-500 text-white"
          }`}
        >
          {validation.valid ? "Passed" : "Failed"}
        </span>
        <span className="font-mono text-xs text-muted">
          {validation.errors.length} error(s), {validation.warnings.length} warning(s)
        </span>
      </div>

      {/* Errors */}
      {validation.errors.length > 0 && (
        <div className="border-2 border-red-500 bg-red-50 p-4">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-red-700">
            Errors
          </p>
          <ul className="mt-2 space-y-1">
            {validation.errors.map((err, i) => (
              <li key={i} className="font-mono text-xs text-red-700">
                &bull; {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && (
        <div className="border-2 border-amber-500 bg-amber-50 p-4">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-amber-700">
            Warnings
          </p>
          <ul className="mt-2 space-y-1">
            {validation.warnings.map((warn, i) => (
              <li key={i} className="font-mono text-xs text-amber-700">
                &bull; {warn}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Checks Passed */}
      {validation.valid && (
        <div className="border-2 border-emerald-500 bg-emerald-50 p-4">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-700">
            All Checks Passed
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-emerald-700">
            <li>&bull; Manifest structure is valid</li>
            <li>&bull; Required fields present</li>
            <li>&bull; Hook names recognized</li>
            <li>&bull; Permissions are valid</li>
            <li>&bull; Runtime type is valid</li>
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="border-2 border-line bg-panel px-6 py-2.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!validation.valid}
          className="border-2 border-line bg-foreground px-6 py-2.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Review &amp; Submit
        </button>
      </div>
    </div>
  );
}

/* ---------- Step 4: Submit ---------- */

function SubmitStep({
  manifest,
  details,
  submitting,
  submitted,
  submitError,
  onSubmit,
  onBack,
}: {
  manifest: ManifestData;
  details: DetailsData;
  submitting: boolean;
  submitted: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="border-2 border-line bg-panel p-8 text-center">
          <span className="border-2 border-amber-500 bg-amber-400 px-4 py-1.5 font-mono text-xs font-bold uppercase text-black">
            Pending Review
          </span>
          <h3 className="mt-6 text-xl font-bold text-foreground">
            Submission Received
          </h3>
          <p className="mt-2 font-mono text-sm text-muted">
            Your plugin <strong>{details.name}</strong> (v{manifest.version}) has
            been submitted for review. You will be notified when it is approved.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/dashboard/plugins"
              className="border-2 border-line bg-panel px-6 py-2.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
            >
              My Plugins
            </Link>
            <Link
              href="/dashboard/marketplace"
              className="border-2 border-line bg-foreground px-6 py-2.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90"
            >
              Marketplace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
        Review Your Submission
      </p>

      {/* Summary Card */}
      <div className="border-2 border-line bg-background p-6">
        <div className="grid grid-cols-2 gap-4 font-mono text-xs">
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Plugin ID
            </span>
            <p className="mt-1 font-bold text-foreground">{manifest.id}</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Name
            </span>
            <p className="mt-1 font-bold text-foreground">{details.name}</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Version
            </span>
            <p className="mt-1 font-bold text-foreground">{manifest.version}</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Author
            </span>
            <p className="mt-1 font-bold text-foreground">{manifest.author}</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Category
            </span>
            <p className="mt-1 font-bold text-foreground">{details.category}</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-muted">
              Runtime
            </span>
            <p className="mt-1 font-bold text-foreground">{manifest.runtime}</p>
          </div>
        </div>

        {/* Description */}
        <div className="mt-4 border-t-2 border-line pt-4">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Description
          </span>
          <p className="mt-1 font-mono text-xs text-foreground">
            {details.description}
          </p>
        </div>

        {/* Hooks */}
        <div className="mt-4 border-t-2 border-line pt-4">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Hooks ({manifest.hooks.length})
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {manifest.hooks.map((h) => (
              <span
                key={h}
                className="border-2 border-line bg-panel px-2 py-0.5 font-mono text-[10px] font-bold text-foreground"
              >
                {h}
              </span>
            ))}
          </div>
        </div>

        {/* Permissions */}
        <div className="mt-4 border-t-2 border-line pt-4">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Permissions ({manifest.permissions.length})
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {manifest.permissions.map((p) => (
              <span
                key={p}
                className="border-2 border-line bg-panel px-2 py-0.5 font-mono text-[10px] font-bold text-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        {manifest.actions.length > 0 && (
          <div className="mt-4 border-t-2 border-line pt-4">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Actions ({manifest.actions.length})
            </span>
            <div className="mt-2 space-y-1">
              {manifest.actions.map((a) => (
                <div key={a.id} className="font-mono text-xs">
                  <span className="font-bold text-foreground">{a.name}</span>
                  <span className="ml-2 text-muted">{a.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div className="border-2 border-red-500 bg-red-50 p-3 font-mono text-xs text-red-700">
          {submitError}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="border-2 border-line bg-panel px-6 py-2.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="border-2 border-line bg-foreground px-6 py-2.5 font-mono text-xs font-bold uppercase text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting..." : "Submit for Review"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function PublishPluginPage() {
  const [step, setStep] = useState(1);
  const [manifestJson, setManifestJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [details, setDetails] = useState<DetailsData>({
    name: "",
    description: "",
    category: "",
    iconPlaceholder: "",
    screenshotsPlaceholder: "",
  });
  const [validation, setValidation] = useState<ValidationResult>({
    valid: false,
    errors: [],
    warnings: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* -- Step 1: Parse manifest -- */
  const handleParse = () => {
    setParseError(null);
    try {
      const parsed = JSON.parse(manifestJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setParseError("Manifest must be a JSON object.");
        return;
      }
      const m: ManifestData = {
        id: parsed.id ?? "",
        name: parsed.name ?? "",
        version: parsed.version ?? "",
        description: parsed.description ?? "",
        author: parsed.author ?? "",
        hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
        permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        uiSlots: Array.isArray(parsed.uiSlots) ? parsed.uiSlots : [],
        oauthRequirements: Array.isArray(parsed.oauthRequirements) ? parsed.oauthRequirements : [],
        configSchema: parsed.configSchema,
        entrypoint: parsed.entrypoint,
        webhookUrl: parsed.webhookUrl,
        runtime: parsed.runtime ?? "webhook",
        icon: parsed.icon,
        category: parsed.category,
      };
      setManifest(m);
      setDetails({
        name: m.name,
        description: m.description,
        category: m.category ?? "",
        iconPlaceholder: m.icon ?? "",
        screenshotsPlaceholder: "",
      });
      setStep(2);
    } catch {
      setParseError("Invalid JSON. Please check your manifest syntax.");
    }
  };

  /* -- Step 3: Validate -- */
  const runValidation = (): ValidationResult => {
    if (!manifest) return { valid: false, errors: ["No manifest loaded"], warnings: [] };
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!manifest.id) errors.push("Missing required field: id");
    if (!manifest.name) errors.push("Missing required field: name");
    if (!manifest.version) errors.push("Missing required field: version");
    if (!manifest.description) errors.push("Missing required field: description");
    if (!manifest.author) errors.push("Missing required field: author");
    if (!manifest.runtime) errors.push("Missing required field: runtime");

    // ID format
    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push("Plugin id must contain only lowercase letters, numbers, and hyphens");
    }

    // Version format (semver-like)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      warnings.push("Version does not follow semver format (x.y.z)");
    }

    // Runtime
    if (manifest.runtime && !["node", "webhook"].includes(manifest.runtime)) {
      errors.push(`Invalid runtime "${manifest.runtime}". Must be "node" or "webhook"`);
    }

    // Hook names
    for (const hook of manifest.hooks) {
      if (!VALID_HOOKS.includes(hook)) {
        errors.push(`Unrecognized hook name: "${hook}"`);
      }
    }

    // Permissions
    for (const perm of manifest.permissions) {
      if (!VALID_PERMISSIONS.includes(perm)) {
        errors.push(`Unrecognized permission: "${perm}"`);
      }
    }

    // Hooks count
    if (manifest.hooks.length === 0) {
      warnings.push("No hooks registered. Plugin will not respond to any events.");
    }

    // Permissions count
    if (manifest.permissions.length === 0) {
      warnings.push("No permissions requested. Plugin will have no data access.");
    }

    // Webhook runtime needs webhookUrl
    if (manifest.runtime === "webhook" && !manifest.webhookUrl) {
      warnings.push("Webhook runtime specified but no webhookUrl provided.");
    }

    // Node runtime needs entrypoint
    if (manifest.runtime === "node" && !manifest.entrypoint) {
      warnings.push("Node runtime specified but no entrypoint provided.");
    }

    return { valid: errors.length === 0, errors, warnings };
  };

  const handleGoToValidation = () => {
    const result = runValidation();
    setValidation(result);
    setStep(3);
  };

  /* -- Step 4: Submit -- */
  const handleSubmit = async () => {
    if (!manifest) return;
    setSubmitting(true);
    setSubmitError(null);

    // Merge details back into manifest
    const finalManifest = {
      ...manifest,
      name: details.name,
      description: details.description,
      category: details.category,
    };

    try {
      const res = await fetch("/api/marketplace/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: finalManifest }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error (${res.status})`);
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/marketplace"
            className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
          >
            &larr; Back to Marketplace
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-foreground">
            Publish Plugin
          </h1>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="mt-8">
        <StepIndicator currentStep={step} />
      </div>

      {/* Step Content */}
      <div className="mt-8 border-2 border-line bg-panel p-8">
        {step === 1 && (
          <ManifestStep
            manifestJson={manifestJson}
            setManifestJson={setManifestJson}
            parseError={parseError}
            onParse={handleParse}
          />
        )}

        {step === 2 && manifest && (
          <DetailsStep
            details={details}
            setDetails={setDetails}
            manifest={manifest}
            onNext={handleGoToValidation}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <ValidationStep
            validation={validation}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}

        {step === 4 && manifest && (
          <SubmitStep
            manifest={manifest}
            details={details}
            submitting={submitting}
            submitted={submitted}
            submitError={submitError}
            onSubmit={handleSubmit}
            onBack={() => setStep(3)}
          />
        )}
      </div>
    </main>
  );
}
