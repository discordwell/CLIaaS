"use client";

interface AgentCapacityBarProps {
  load: number;
  capacity: number;
  label?: string;
}

export default function AgentCapacityBar({ load, capacity, label }: AgentCapacityBarProps) {
  const pct = capacity > 0 ? Math.min(100, Math.round((load / capacity) * 100)) : 0;
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold">{label}</span>
          <span className="font-mono text-xs text-zinc-500">
            {load}/{capacity}
          </span>
        </div>
      )}
      <div className="mt-1 h-2 w-full bg-zinc-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
