"use client";

type Status = "online" | "away" | "offline";

const STATUS_COLORS: Record<Status, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  offline: "bg-zinc-400",
};

export default function AgentAvailabilityIndicator({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.offline}`}
      title={status}
    />
  );
}
