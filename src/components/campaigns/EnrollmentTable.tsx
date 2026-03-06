"use client";

interface Enrollment {
  id: string;
  customerId: string;
  status: "active" | "completed" | "exited" | "failed";
  currentStepId?: string;
  enrolledAt: string;
  completedAt?: string;
  nextExecutionAt?: string;
}

interface EnrollmentTableProps {
  enrollments: Enrollment[];
  stepNames: Record<string, string>;
}

function statusColor(status: Enrollment["status"]): string {
  switch (status) {
    case "active":
      return "bg-blue-100 text-blue-700";
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "exited":
      return "bg-zinc-200 text-zinc-600";
    case "failed":
      return "bg-red-100 text-red-700";
  }
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EnrollmentTable({ enrollments, stepNames }: EnrollmentTableProps) {
  if (enrollments.length === 0) {
    return (
      <div className="border-2 border-dashed border-zinc-300 p-8 text-center">
        <p className="font-mono text-sm text-zinc-500">No enrollments yet</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
              <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                Customer
              </th>
              <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                Status
              </th>
              <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                Current Step
              </th>
              <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                Enrolled
              </th>
              <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                Next Execution
              </th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100">
                <td className="px-4 py-3 font-mono text-xs">
                  {e.customerId}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor(e.status)}`}
                  >
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                  {e.currentStepId ? stepNames[e.currentStepId] ?? e.currentStepId : "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                  {shortDate(e.enrolledAt)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                  {e.nextExecutionAt ? shortDate(e.nextExecutionAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
