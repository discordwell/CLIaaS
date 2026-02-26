/** Shared portal UI constants. */

export const statusColor: Record<string, string> = {
  open: "bg-blue-500 text-white",
  pending: "bg-amber-400 text-black",
  solved: "bg-emerald-500 text-white",
  closed: "bg-zinc-500 text-white",
};

export const priorityDot: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-zinc-300",
  low: "bg-zinc-200",
};
