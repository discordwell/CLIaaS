"use client";

import { useCallback, useEffect, useState } from "react";

interface CrmLinkData {
  id: string;
  crmObjectType: string;
  crmObjectId: string;
  crmObjectUrl?: string;
  crmData: Record<string, unknown>;
  lastSyncedAt?: string;
}

interface CrmProviderData {
  provider: string;
  links: CrmLinkData[];
}

interface CrmPanelProps {
  customerId: string;
  customerEmail?: string;
}

const providerBadge: Record<string, { label: string; color: string }> = {
  salesforce: { label: "SF", color: "bg-sky-500" },
  "hubspot-crm": { label: "HS", color: "bg-orange-500" },
};

export default function CrmPanel({ customerId }: CrmPanelProps) {
  const [providers, setProviders] = useState<CrmProviderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkForm, setShowLinkForm] = useState(false);

  // Link form
  const [formProvider, setFormProvider] = useState("salesforce");
  const [formObjectType, setFormObjectType] = useState("Contact");
  const [formObjectId, setFormObjectId] = useState("");
  const [formObjectUrl, setFormObjectUrl] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/crm-links`);
      if (!res.ok) return;
      const data = await res.json();
      setProviders(data.crm ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/crm-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: formProvider,
          crmObjectType: formObjectType,
          crmObjectId: formObjectId,
          crmObjectUrl: formObjectUrl || undefined,
          crmData: {},
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      setShowLinkForm(false);
      setFormObjectId("");
      setFormObjectUrl("");
      fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleUnlink(linkId: string) {
    try {
      await fetch(`/api/customers/${customerId}/crm-links/${linkId}`, { method: "DELETE" });
      fetchData();
    } catch {
      // silent
    }
  }

  const allLinks = providers.flatMap((p) =>
    p.links.map((l) => ({ ...l, provider: p.provider }))
  );

  const allDeals: Array<Record<string, unknown> & { provider: string }> = allLinks.flatMap((link) => {
    const deals = link.crmData?.deals;
    if (Array.isArray(deals)) {
      return (deals as Array<Record<string, unknown>>).map((d) => ({
        ...d,
        provider: link.provider,
      }));
    }
    return [];
  });

  if (loading) {
    return (
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          CRM Profiles
        </h2>
        <p className="mt-4 font-mono text-sm text-zinc-400">Loading CRM data...</p>
      </section>
    );
  }

  return (
    <div>
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            CRM Profiles
          </h2>
          <button
            onClick={() => setShowLinkForm(!showLinkForm)}
            className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
          >
            {showLinkForm ? "Cancel" : "Link CRM Record"}
          </button>
        </div>

        {/* Link form */}
        {showLinkForm && (
          <form onSubmit={handleLink} className="mt-4 border-2 border-zinc-300 bg-zinc-50 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">Provider</span>
                <select
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                >
                  <option value="salesforce">Salesforce</option>
                  <option value="hubspot-crm">HubSpot</option>
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-xs font-bold uppercase">Object Type</span>
                <select
                  value={formObjectType}
                  onChange={(e) => setFormObjectType(e.target.value)}
                  className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                >
                  <option value="Contact">Contact</option>
                  <option value="Account">Account</option>
                  <option value="Lead">Lead</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">CRM Record ID</span>
              <input
                required
                value={formObjectId}
                onChange={(e) => setFormObjectId(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="e.g. 003xxxxxxxxxxxx"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">CRM URL (optional)</span>
              <input
                value={formObjectUrl}
                onChange={(e) => setFormObjectUrl(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="https://..."
              />
            </label>
            {formError && (
              <p className="font-mono text-xs text-red-500">{formError}</p>
            )}
            <button
              type="submit"
              disabled={formSubmitting}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {formSubmitting ? "Linking..." : "Link Record"}
            </button>
          </form>
        )}

        {/* Linked CRM records */}
        {allLinks.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-zinc-400">
            No CRM records linked to this customer.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {allLinks.map((link) => {
              const badge = providerBadge[link.provider] ?? {
                label: link.provider.slice(0, 2).toUpperCase(),
                color: "bg-zinc-500",
              };
              const name = (link.crmData?.name as string) || link.crmObjectId;
              const email = link.crmData?.email as string | undefined;
              const title = link.crmData?.title as string | undefined;
              const company =
                (link.crmData?.accountName as string) ||
                (link.crmData?.company as string) ||
                undefined;

              return (
                <div
                  key={link.id}
                  className="flex items-start justify-between border-2 border-zinc-300 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                      <span className="font-bold">{name}</span>
                      <span className="font-mono text-xs text-zinc-400">
                        {link.crmObjectType}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 font-mono text-xs text-zinc-500">
                      {email && <span>{email}</span>}
                      {title && <span>{title}</span>}
                      {company && <span>{company}</span>}
                    </div>
                    {link.lastSyncedAt && (
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">
                        Synced {new Date(link.lastSyncedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {link.crmObjectUrl && (
                      <a
                        href={link.crmObjectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-900"
                      >
                        Open
                      </a>
                    )}
                    <button
                      onClick={() => handleUnlink(link.id)}
                      className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Deals / Opportunities */}
      {allDeals.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Deals &amp; Opportunities
          </h2>
          <div className="mt-4 space-y-3">
            {allDeals.map((deal, idx) => {
              const name = (deal.name as string) ?? "Untitled Deal";
              const stage = deal.stage as string | undefined;
              const amount = deal.amount as number | undefined;
              const closeDate = deal.closeDate as string | undefined;
              const badge = providerBadge[deal.provider as string] ?? {
                label: "CRM",
                color: "bg-zinc-500",
              };

              return (
                <div
                  key={`deal-${idx}`}
                  className="flex items-center justify-between border-2 border-zinc-300 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                      <span className="font-bold">{name}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 font-mono text-xs text-zinc-500">
                      {stage && <span>Stage: {stage}</span>}
                      {amount != null && (
                        <span>
                          ${Number(amount).toLocaleString()}
                        </span>
                      )}
                      {closeDate && (
                        <span>
                          Close: {new Date(closeDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
