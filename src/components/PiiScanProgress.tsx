"use client";

interface PiiScanProgressProps {
  jobId: string;
  status: string;
  totalRecords: number;
  scannedRecords: number;
  detectionsFound: number;
}

export default function PiiScanProgress({ jobId, status, totalRecords, scannedRecords, detectionsFound }: PiiScanProgressProps) {
  const percentage = totalRecords > 0 ? Math.round((scannedRecords / totalRecords) * 100) : 0;
  const isRunning = status === "running" || status === "queued";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-300">
          Scan {jobId.slice(0, 8)}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded ${
          status === "completed" ? "bg-green-900/50 text-green-300" :
          status === "failed" ? "bg-red-900/50 text-red-300" :
          status === "cancelled" ? "bg-zinc-800 text-zinc-500" :
          "bg-yellow-900/50 text-yellow-300"
        }`}>
          {status}
        </span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all ${isRunning ? "bg-blue-500" : "bg-green-500"}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{scannedRecords.toLocaleString()} / {totalRecords.toLocaleString()} records</span>
        <span>{detectionsFound} detections found</span>
      </div>
    </div>
  );
}
