"use client";

interface RoutingQueueCardProps {
  name: string;
  strategy: string;
  enabled: boolean;
  totalRouted: number;
  groupName?: string;
}

const STRATEGY_LABELS: Record<string, string> = {
  round_robin: "Round Robin",
  load_balanced: "Load Balanced",
  skill_match: "Skill Match",
  priority_weighted: "Priority Weighted",
};

export default function RoutingQueueCard({
  name,
  strategy,
  enabled,
  totalRouted,
  groupName,
}: RoutingQueueCardProps) {
  return (
    <div className="border-2 border-zinc-200 p-4">
      <div className="flex items-center justify-between">
        <p className="font-bold">{name}</p>
        <span
          className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
            enabled
              ? "bg-emerald-100 text-emerald-700"
              : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {enabled ? "Active" : "Disabled"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="border border-zinc-300 bg-zinc-50 px-2 py-0.5 font-mono text-xs">
          {STRATEGY_LABELS[strategy] ?? strategy}
        </span>
        {groupName && (
          <span className="font-mono text-xs text-zinc-500">
            Group: {groupName}
          </span>
        )}
      </div>
      <p className="mt-2 font-mono text-xs text-zinc-500">
        {totalRouted} tickets routed
      </p>
    </div>
  );
}
