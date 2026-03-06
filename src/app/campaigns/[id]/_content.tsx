"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import StepEditor from "@/components/campaigns/StepEditor";
import SegmentPicker from "@/components/campaigns/SegmentPicker";
import EnrollmentTable from "@/components/campaigns/EnrollmentTable";
import type { CampaignStepType } from "@/lib/campaigns/campaign-store";

interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: string;
  subject?: string;
  templateBody?: string;
  segmentQuery?: { conditions?: { field: string; operator: string; value: string }[] };
  entryStepId?: string;
  createdAt: string;
  updatedAt: string;
}

interface StepData {
  id: string;
  stepType: CampaignStepType;
  position: number;
  name: string;
  config: Record<string, unknown>;
  delaySeconds?: number;
  conditionQuery?: Record<string, unknown>;
}

interface Enrollment {
  id: string;
  customerId: string;
  status: "active" | "completed" | "exited" | "failed";
  currentStepId?: string;
  enrolledAt: string;
  completedAt?: string;
  nextExecutionAt?: string;
}

function statusColor(status: string): string {
  switch (status) {
    case "draft": return "bg-zinc-200 text-zinc-600";
    case "active": return "bg-emerald-100 text-emerald-700";
    case "paused": return "bg-amber-100 text-amber-700";
    case "completed": return "bg-blue-100 text-blue-700";
    case "sent": return "bg-emerald-100 text-emerald-700";
    case "cancelled": return "bg-red-100 text-red-700";
    default: return "bg-zinc-200 text-zinc-600";
  }
}

export default function CampaignDetailContent({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"steps" | "segment" | "enrollments">("steps");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [segmentConditions, setSegmentConditions] = useState<{ field: string; operator: string; value: string }[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  const loadCampaign = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCampaign(data.campaign);
      if (data.campaign?.segmentQuery?.conditions) {
        setSegmentConditions(data.campaign.segmentQuery.conditions);
      }
    } catch { /* ignore */ }
  }, [campaignId]);

  const loadSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`);
      if (!res.ok) return;
      const data = await res.json();
      setSteps(data.steps ?? []);
    } catch { /* ignore */ }
  }, [campaignId]);

  const loadEnrollments = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/enrollments`);
      if (!res.ok) return;
      const data = await res.json();
      setEnrollments(data.enrollments ?? []);
    } catch { /* ignore */ }
  }, [campaignId]);

  useEffect(() => {
    Promise.all([loadCampaign(), loadSteps(), loadEnrollments()]).finally(() => setLoading(false));
  }, [loadCampaign, loadSteps, loadEnrollments]);

  async function handleAddStep(stepType: CampaignStepType, _position: number) {
    const defaultNames: Record<string, string> = {
      send_email: "Send Email",
      send_sms: "Send SMS",
      send_in_app: "In-App Message",
      send_push: "Push Notification",
      wait_delay: "Wait",
      wait_event: "Wait for Event",
      condition: "Condition",
      branch: "Branch",
      update_tag: "Update Tag",
      webhook: "Webhook",
    };
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType, name: defaultNames[stepType] ?? stepType }),
      });
      if (res.ok) loadSteps();
    } catch { /* ignore */ }
  }

  async function handleUpdateStep(stepId: string, updates: Partial<StepData>) {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${stepId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) loadSteps();
    } catch { /* ignore */ }
  }

  async function handleDeleteStep(stepId: string) {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps/${stepId}`, {
        method: "DELETE",
      });
      if (res.ok) loadSteps();
    } catch { /* ignore */ }
  }

  async function handleReorder(stepIds: string[]) {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", stepIds }),
      });
      if (res.ok) loadSteps();
    } catch { /* ignore */ }
  }

  async function handlePreview() {
    try {
      const res = await fetch("/api/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions: segmentConditions.filter((c) => c.value || ["exists", "not_exists"].includes(c.operator)),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewCount(data.count ?? 0);
      }
    } catch { /* ignore */ }
  }

  async function handleSegmentSave() {
    try {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentQuery: {
            conditions: segmentConditions.filter((c) => c.value || ["exists", "not_exists"].includes(c.operator)),
          },
        }),
      });
      loadCampaign();
    } catch { /* ignore */ }
  }

  async function handleLifecycle(action: "activate" | "pause" | "resume") {
    setActionLoading(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      loadCampaign();
      loadEnrollments();
    } catch { /* ignore */ }
    finally { setActionLoading(false); }
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading campaign...</p>
        </section>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">Campaign not found</p>
          <Link href="/campaigns" className="mt-2 inline-block font-mono text-xs font-bold text-blue-600 hover:text-blue-800">
            Back to Campaigns
          </Link>
        </section>
      </main>
    );
  }

  const stepNames: Record<string, string> = {};
  for (const s of steps) stepNames[s.id] = s.name;

  const isDraft = campaign.status === "draft";
  const isActive = campaign.status === "active";
  const isPaused = campaign.status === "paused";

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/campaigns" className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950">
              Campaigns /
            </Link>
            <h1 className="mt-2 text-3xl font-bold">{campaign.name}</h1>
            <div className="mt-2 flex items-center gap-3">
              <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor(campaign.status)}`}>
                {campaign.status}
              </span>
              <span className="font-mono text-xs uppercase text-zinc-500">{campaign.channel}</span>
              <span className="font-mono text-xs text-zinc-400">{steps.length} steps</span>
              <span className="font-mono text-xs text-zinc-400">{enrollments.length} enrolled</span>
            </div>
          </div>
          <div className="flex gap-2">
            {isDraft && steps.length > 0 && (
              <button
                onClick={() => handleLifecycle("activate")}
                disabled={actionLoading}
                className="border-2 border-emerald-600 bg-emerald-600 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Activate
              </button>
            )}
            {isActive && (
              <button
                onClick={() => handleLifecycle("pause")}
                disabled={actionLoading}
                className="border-2 border-amber-600 bg-amber-600 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Pause
              </button>
            )}
            {isPaused && (
              <button
                onClick={() => handleLifecycle("resume")}
                disabled={actionLoading}
                className="border-2 border-blue-600 bg-blue-600 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Resume
              </button>
            )}
            <Link
              href={`/campaigns/${campaignId}/analytics`}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              Analytics
            </Link>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mt-4 flex gap-0 border-2 border-zinc-950 bg-white">
        {(["steps", "segment", "enrollments"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-3 font-mono text-xs font-bold uppercase transition-colors ${
              tab === t ? "bg-zinc-950 text-white" : "text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {t === "steps" ? `Steps (${steps.length})` : t === "segment" ? "Segment" : `Enrollments (${enrollments.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <section className="mt-4">
        {tab === "steps" && (
          <StepEditor
            campaignId={campaignId}
            steps={steps}
            onAddStep={handleAddStep}
            onUpdateStep={handleUpdateStep}
            onDeleteStep={handleDeleteStep}
            onReorder={handleReorder}
            disabled={!isDraft && !isPaused}
          />
        )}

        {tab === "segment" && (
          <div className="border-2 border-zinc-950 bg-white p-6">
            <SegmentPicker
              conditions={segmentConditions}
              onChange={setSegmentConditions}
              onPreview={handlePreview}
              previewCount={previewCount}
              disabled={!isDraft}
            />
            {isDraft && (
              <button
                onClick={handleSegmentSave}
                className="mt-4 w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Save Segment
              </button>
            )}
          </div>
        )}

        {tab === "enrollments" && (
          <EnrollmentTable enrollments={enrollments} stepNames={stepNames} />
        )}
      </section>
    </main>
  );
}
