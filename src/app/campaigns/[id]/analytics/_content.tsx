"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import FunnelChart from "@/components/campaigns/FunnelChart";

interface FunnelEntry {
  stepId: string;
  stepName: string;
  stepType: string;
  position: number;
  executed: number;
  completed: number;
  failed: number;
  skipped: number;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface CampaignAnalytics {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

export default function CampaignAnalyticsContent({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [funnel, setFunnel] = useState<FunnelEntry[]>([]);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [campRes, funnelRes, analyticsRes] = await Promise.all([
        fetch(`/api/campaigns/${campaignId}`),
        fetch(`/api/campaigns/${campaignId}/funnel`),
        fetch(`/api/campaigns/${campaignId}/analytics`),
      ]);

      if (campRes.ok) {
        const data = await campRes.json();
        setCampaign(data.campaign);
      }
      if (funnelRes.ok) {
        const data = await funnelRes.json();
        setFunnel(data.funnel ?? []);
      }
      if (analyticsRes.ok) {
        const data = await analyticsRes.json();
        setAnalytics(data.analytics ?? null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading analytics...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <Link href={`/campaigns/${campaignId}`} className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950">
          {campaign?.name ?? "Campaign"} /
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Analytics</h1>
      </header>

      {/* Recipient-level analytics */}
      {analytics && (
        <section className="mt-4 border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-200 p-6">
            <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
              Delivery Overview
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: "Total", value: analytics.total },
              { label: "Pending", value: analytics.pending },
              { label: "Sent", value: analytics.sent },
              { label: "Delivered", value: analytics.delivered },
              { label: "Opened", value: analytics.opened },
              { label: "Clicked", value: analytics.clicked },
              { label: "Failed", value: analytics.failed },
            ].map((s) => (
              <div key={s.label} className="border border-zinc-200 p-3">
                <p className="font-mono text-xs text-zinc-500">{s.label}</p>
                <p className="mt-1 text-xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step Funnel */}
      <section className="mt-4 border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-200 p-6">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Step Funnel
          </h2>
        </div>
        <div className="p-6">
          <FunnelChart data={funnel} />
        </div>
      </section>
    </main>
  );
}
