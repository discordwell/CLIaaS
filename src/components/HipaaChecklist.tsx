"use client";

interface HipaaControl {
  id: string;
  category: string;
  name: string;
  description: string;
  status: "pass" | "fail" | "partial" | "na";
  evidence: string[];
  remediation?: string;
}

interface HipaaChecklistProps {
  controls: HipaaControl[];
}

export default function HipaaChecklist({ controls }: HipaaChecklistProps) {
  const passCount = controls.filter((c) => c.status === "pass").length;
  const applicable = controls.filter((c) => c.status !== "na").length;

  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-400 mb-2">
        {passCount} of {applicable} controls passing
      </div>
      {controls.map((c) => (
        <div key={c.id} className="flex items-start gap-3 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <span className={`text-lg mt-0.5 ${
            c.status === "pass" ? "text-green-400" :
            c.status === "fail" ? "text-red-400" :
            c.status === "partial" ? "text-yellow-400" :
            "text-zinc-600"
          }`}>
            {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "partial" ? "◐" : "—"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-200">{c.name}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{c.description}</div>
            {c.evidence.map((e, i) => (
              <div key={i} className="text-xs text-zinc-600 mt-0.5">• {e}</div>
            ))}
            {c.remediation && (
              <div className="text-xs text-yellow-500/80 mt-1">Fix: {c.remediation}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
