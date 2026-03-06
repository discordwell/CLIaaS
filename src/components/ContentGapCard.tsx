"use client";

interface ContentGap {
  id: string;
  topic: string;
  ticketCount: number;
  status: string;
  suggestedTitle?: string;
  suggestedOutline?: string;
}

interface ContentGapCardProps {
  gap: ContentGap;
  onCreateArticle?: (gapId: string) => void;
  onDismiss?: (gapId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-amber-500 bg-amber-50 text-amber-700",
  accepted: "border-blue-500 bg-blue-50 text-blue-700",
  stale: "border-zinc-400 bg-zinc-100 text-zinc-500",
  dismissed: "border-zinc-400 bg-zinc-100 text-zinc-500",
};

export default function ContentGapCard({
  gap,
  onCreateArticle,
  onDismiss,
}: ContentGapCardProps) {
  const statusClass = STATUS_COLORS[gap.status] ?? STATUS_COLORS.open;

  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-bold">{gap.topic}</h3>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`border px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusClass}`}
              >
                {gap.status}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {gap.ticketCount} ticket{gap.ticketCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {gap.suggestedTitle && (
          <div className="mt-4">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Suggested Title
            </p>
            <p className="mt-1 text-sm text-zinc-700">{gap.suggestedTitle}</p>
          </div>
        )}

        {gap.suggestedOutline && (
          <div className="mt-3">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Suggested Outline
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">
              {gap.suggestedOutline}
            </p>
          </div>
        )}

        {gap.status === "open" && (
          <div className="mt-6 flex gap-3">
            {onCreateArticle && (
              <button
                onClick={() => onCreateArticle(gap.id)}
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
              >
                Create Article
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(gap.id)}
                className="border-2 border-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-100"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
