"use client";

interface PiiDetection {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  piiType: string;
  maskedValue: string;
  confidence: number;
  status: string;
  createdAt: string;
}

interface PiiDetectionTableProps {
  detections: PiiDetection[];
  onReview?: (id: string, action: "confirm" | "dismiss") => void;
  onRedact?: (id: string) => void;
  loading?: boolean;
}

export default function PiiDetectionTable({ detections, onReview, onRedact, loading }: PiiDetectionTableProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Entity</th>
            <th className="px-4 py-3 text-left font-medium">Masked Value</th>
            <th className="px-4 py-3 text-left font-medium">Confidence</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            {(onReview || onRedact) && <th className="px-4 py-3 text-left font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {detections.map((d) => (
            <tr key={d.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
              <td className="px-4 py-3">
                <span className="inline-block px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-300">
                  {d.piiType.replace("_", " ")}
                </span>
              </td>
              <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                {d.entityType}:{d.entityId.slice(0, 8)}
              </td>
              <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{d.maskedValue}</td>
              <td className="px-4 py-3 text-zinc-400">{Math.round(d.confidence * 100)}%</td>
              <td className="px-4 py-3">
                <PiiStatusBadge status={d.status} />
              </td>
              {(onReview || onRedact) && (
                <td className="px-4 py-3">
                  {d.status === "pending" && onReview && (
                    <div className="flex gap-1">
                      <button onClick={() => onReview(d.id, "confirm")} disabled={loading} className="px-2 py-1 text-xs bg-green-900/50 text-green-300 rounded hover:bg-green-900">Confirm</button>
                      <button onClick={() => onReview(d.id, "dismiss")} disabled={loading} className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700">Dismiss</button>
                    </div>
                  )}
                  {d.status === "confirmed" && onRedact && (
                    <button onClick={() => onRedact(d.id)} disabled={loading} className="px-2 py-1 text-xs bg-red-900/50 text-red-300 rounded hover:bg-red-900">Redact</button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {detections.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No detections</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PiiStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-900/50 text-yellow-300",
    confirmed: "bg-blue-900/50 text-blue-300",
    redacted: "bg-green-900/50 text-green-300",
    auto_redacted: "bg-green-900/50 text-green-300",
    dismissed: "bg-zinc-800 text-zinc-500",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${colors[status] || "bg-zinc-800 text-zinc-400"}`}>
      {status.replace("_", " ")}
    </span>
  );
}
