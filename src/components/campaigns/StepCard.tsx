"use client";

import type { CampaignStepType } from "@/lib/campaigns/campaign-store";

const STEP_ICONS: Record<CampaignStepType, string> = {
  send_email: "✉",
  send_sms: "💬",
  send_in_app: "📢",
  send_push: "🔔",
  wait_delay: "⏳",
  wait_event: "👁",
  condition: "❓",
  branch: "🔀",
  update_tag: "🏷",
  webhook: "🔗",
};

const STEP_LABELS: Record<CampaignStepType, string> = {
  send_email: "Send Email",
  send_sms: "Send SMS",
  send_in_app: "In-App Message",
  send_push: "Push Notification",
  wait_delay: "Wait / Delay",
  wait_event: "Wait for Event",
  condition: "Condition",
  branch: "Branch",
  update_tag: "Update Tag",
  webhook: "Webhook",
};

interface StepCardProps {
  id: string;
  stepType: CampaignStepType;
  name: string;
  position: number;
  delaySeconds?: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function formatDelay(seconds: number): string {
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

export default function StepCard({
  stepType,
  name,
  delaySeconds,
  isSelected,
  onSelect,
  onDelete,
}: StepCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer border-2 bg-white p-4 transition-colors ${
        isSelected ? "border-zinc-950 shadow-[4px_4px_0_0_rgba(0,0,0,1)]" : "border-zinc-300 hover:border-zinc-500"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{STEP_ICONS[stepType]}</span>
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              {STEP_LABELS[stepType]}
            </p>
            <p className="text-sm font-medium">{name}</p>
            {stepType === "wait_delay" && delaySeconds != null && (
              <p className="font-mono text-xs text-zinc-400">
                Wait {formatDelay(delaySeconds)}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="font-mono text-xs font-bold text-red-500 hover:text-red-700"
          title="Delete step"
        >
          ×
        </button>
      </div>
    </div>
  );
}
