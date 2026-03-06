"use client";

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

interface FunnelChartProps {
  data: FunnelEntry[];
}

export default function FunnelChart({ data }: FunnelChartProps) {
  if (data.length === 0) {
    return (
      <div className="border-2 border-dashed border-zinc-300 p-8 text-center">
        <p className="font-mono text-sm text-zinc-500">No funnel data yet</p>
      </div>
    );
  }

  const maxExecuted = Math.max(...data.map((d) => d.executed), 1);

  return (
    <div className="space-y-3">
      {data.map((entry, i) => {
        const widthPct = Math.max((entry.executed / maxExecuted) * 100, 4);
        const conversionPct =
          i > 0 && data[i - 1].executed > 0
            ? Math.round((entry.executed / data[i - 1].executed) * 100)
            : 100;

        return (
          <div key={entry.stepId}>
            {/* Conversion indicator between steps */}
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pl-2">
                <div className="h-4 w-px bg-zinc-300" />
                <span className="font-mono text-xs text-zinc-400">
                  {conversionPct}% continued
                </span>
              </div>
            )}

            <div className="flex items-center gap-3">
              {/* Position marker */}
              <span className="w-6 text-center font-mono text-xs font-bold text-zinc-400">
                {entry.position + 1}
              </span>

              {/* Bar */}
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase text-zinc-600">
                    {entry.stepName}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">
                    {entry.executed} executed
                  </span>
                </div>
                <div className="h-6 w-full bg-zinc-100">
                  <div
                    className="flex h-full items-center bg-zinc-950 px-2"
                    style={{ width: `${widthPct}%` }}
                  >
                    {entry.executed > 0 && (
                      <span className="font-mono text-xs font-bold text-white">
                        {entry.completed}
                      </span>
                    )}
                  </div>
                </div>
                {/* Stats row */}
                <div className="mt-1 flex gap-4 font-mono text-xs text-zinc-400">
                  <span>{entry.completed} completed</span>
                  {entry.failed > 0 && (
                    <span className="text-red-500">{entry.failed} failed</span>
                  )}
                  {entry.skipped > 0 && (
                    <span>{entry.skipped} skipped</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
