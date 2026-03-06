"use client";

import { useState, useEffect, useCallback } from "react";

interface ExternalLink {
  id: string;
  provider: string;
  externalId: string;
  externalKey: string;
  externalUrl: string;
  externalStatus: string;
  title: string;
  syncStatus: string;
  lastSyncedAt: string | null;
}

interface EngineeringLinksPanelProps {
  ticketId: string;
  ticketSubject: string;
}

type FormMode = "none" | "link" | "create";

function ProviderBadge({ provider }: { provider: string }) {
  const upper = provider.toUpperCase();
  const colors =
    upper === "JIRA"
      ? "bg-blue-100 text-blue-700"
      : upper === "LINEAR"
        ? "bg-violet-100 text-violet-700"
        : "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${colors}`}
    >
      {upper}
    </span>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const colors =
    status === "synced"
      ? "bg-emerald-100 text-emerald-700"
      : status === "pending"
        ? "bg-amber-100 text-amber-700"
        : status === "error"
          ? "bg-red-100 text-red-700"
          : "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${colors}`}
    >
      {status}
    </span>
  );
}

export default function EngineeringLinksPanel({
  ticketId,
  ticketSubject,
}: EngineeringLinksPanelProps) {
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("none");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Link form state
  const [linkProvider, setLinkProvider] = useState<"jira" | "linear">("jira");
  const [linkIssueKey, setLinkIssueKey] = useState("");

  // Create form state
  const [createProvider, setCreateProvider] = useState<"jira" | "linear">(
    "jira",
  );
  const [createProjectKey, setCreateProjectKey] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/external-links`);
      if (res.ok) {
        const data = await res.json();
        setLinks(data.links ?? []);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const openLinkForm = () => {
    setFormMode("link");
    setLinkProvider("jira");
    setLinkIssueKey("");
    setError(null);
  };

  const openCreateForm = () => {
    setFormMode("create");
    setCreateProvider("jira");
    setCreateProjectKey("");
    setCreateTitle(ticketSubject);
    setCreateDescription("");
    setError(null);
  };

  const closeForm = () => {
    setFormMode("none");
    setError(null);
  };

  const handleLink = async () => {
    if (!linkIssueKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/external-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: linkProvider,
          action: "link",
          issueKey: linkIssueKey.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to link issue");
      }
      closeForm();
      fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link issue");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!createTitle.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/external-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: createProvider,
          action: "create",
          subject: createTitle.trim(),
          description: createDescription.trim(),
          projectKey:
            createProvider === "jira" ? createProjectKey.trim() : undefined,
          teamId:
            createProvider === "linear" ? createProjectKey.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create issue");
      }
      closeForm();
      fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async (linkId: string) => {
    setSyncingId(linkId);
    try {
      await fetch(`/api/tickets/${ticketId}/external-links/${linkId}/sync`, {
        method: "POST",
      });
      fetchLinks();
    } catch {
      // Ignore
    } finally {
      setSyncingId(null);
    }
  };

  const handleUnlink = async (linkId: string) => {
    setUnlinkingId(linkId);
    try {
      await fetch(`/api/tickets/${ticketId}/external-links/${linkId}`, {
        method: "DELETE",
      });
      fetchLinks();
    } catch {
      // Ignore
    } finally {
      setUnlinkingId(null);
    }
  };

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Engineering Links
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={formMode === "link" ? closeForm : openLinkForm}
            className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
          >
            {formMode === "link" ? "Cancel" : "Link Existing Issue"}
          </button>
          <button
            type="button"
            onClick={formMode === "create" ? closeForm : openCreateForm}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {formMode === "create" ? "Cancel" : "Create Issue"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 border-2 border-red-300 bg-red-50 px-4 py-2 font-mono text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Link existing issue form */}
      {formMode === "link" && (
        <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4">
          <div className="flex items-center gap-3">
            <select
              value={linkProvider}
              onChange={(e) =>
                setLinkProvider(e.target.value as "jira" | "linear")
              }
              className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            >
              <option value="jira">Jira</option>
              <option value="linear">Linear</option>
            </select>
            <input
              type="text"
              value={linkIssueKey}
              onChange={(e) => setLinkIssueKey(e.target.value)}
              placeholder={
                linkProvider === "jira" ? "e.g. PROJ-123" : "e.g. ENG-456"
              }
              className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
            <button
              type="button"
              onClick={handleLink}
              disabled={submitting || !linkIssueKey.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? "Linking..." : "Link"}
            </button>
          </div>
        </div>
      )}

      {/* Create issue form */}
      {formMode === "create" && (
        <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4">
          <div className="flex items-center gap-3">
            <select
              value={createProvider}
              onChange={(e) =>
                setCreateProvider(e.target.value as "jira" | "linear")
              }
              className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            >
              <option value="jira">Jira</option>
              <option value="linear">Linear</option>
            </select>
            <input
              type="text"
              value={createProjectKey}
              onChange={(e) => setCreateProjectKey(e.target.value)}
              placeholder={
                createProvider === "jira"
                  ? "Project key (e.g. PROJ)"
                  : "Team ID or slug"
              }
              className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </div>
          <input
            type="text"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="Issue title"
            className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <textarea
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !createTitle.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Issue"}
            </button>
          </div>
        </div>
      )}

      {/* Links list */}
      <div className="mt-4">
        {loading && links.length === 0 ? (
          <p className="py-4 text-center font-mono text-xs text-zinc-400">
            Loading...
          </p>
        ) : links.length === 0 ? (
          <p className="py-4 text-center font-mono text-xs text-zinc-400">
            No engineering links yet
          </p>
        ) : (
          <div className="divide-y divide-zinc-200">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <ProviderBadge provider={link.provider} />
                  <span className="border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px]">
                    {link.externalKey}
                  </span>
                  <span className="truncate text-sm font-medium text-zinc-900">
                    {link.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase text-zinc-500">
                    {link.externalStatus}
                  </span>
                  <SyncStatusBadge status={link.syncStatus} />
                  {link.lastSyncedAt && (
                    <span className="font-mono text-[10px] text-zinc-400">
                      {new Date(link.lastSyncedAt).toLocaleString()}
                    </span>
                  )}
                  <a
                    href={link.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => handleSync(link.id)}
                    disabled={syncingId === link.id}
                    className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950 disabled:opacity-50"
                  >
                    {syncingId === link.id ? "Syncing..." : "Sync"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUnlink(link.id)}
                    disabled={unlinkingId === link.id}
                    className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-red-500 hover:border-red-500 disabled:opacity-50"
                  >
                    {unlinkingId === link.id ? "Removing..." : "Unlink"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
