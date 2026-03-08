"use client";

import Link from "next/link";
import { useDensity } from "./DensityProvider";

interface ActionableTicketRow {
  id: string;
  subject: string;
  priority: string;
  status: string;
  assignee?: string;
  slaLabel: string;
}

const rowPad = {
  spacious: "p-4",
  comfortable: "p-3",
  compact: "p-1.5 px-3",
} as const;

const gapSize = {
  spacious: "gap-2",
  comfortable: "gap-1.5",
  compact: "gap-1",
} as const;

const fontSize = {
  spacious: "text-sm",
  comfortable: "text-sm",
  compact: "text-xs",
} as const;

const pillPad = {
  spacious: "px-2 py-0.5 text-[10px]",
  comfortable: "px-2 py-0.5 text-[10px]",
  compact: "px-1.5 py-0 text-[9px]",
} as const;

export default function ActionableTicketList({ tickets }: { tickets: ActionableTicketRow[] }) {
  const { density } = useDensity();

  if (tickets.length === 0) {
    return (
      <p className="mt-3 font-mono text-sm text-muted">
        All clear. No tickets need attention right now.
      </p>
    );
  }

  const formatAssignee = (name: string | undefined) => {
    if (!name) return "Unassigned";
    if (density === "compact") {
      return name.split(" ").map((w) => w[0]).join("").toUpperCase();
    }
    return name;
  };

  return (
    <div className={`mt-3 flex flex-col ${gapSize[density]} font-mono ${fontSize[density]}`}>
      {tickets.map((t) => (
        <Link
          key={t.id}
          href={`/tickets/${t.id}`}
          className={`flex items-center justify-between border-2 border-line ${rowPad[density]} transition-colors hover:bg-accent-soft`}
        >
          <span className="min-w-0 flex-1 truncate font-bold">
            {t.subject}
          </span>
          <span className={`ml-3 flex shrink-0 items-center ${density === "compact" ? "gap-1.5" : "gap-2"}`}>
            <span
              className={`border-2 border-line ${pillPad[density]} font-bold uppercase ${
                t.priority === "urgent"
                  ? "bg-red-500 text-white"
                  : t.priority === "high"
                    ? "bg-orange-400 text-black"
                    : "bg-zinc-200 text-zinc-700"
              }`}
            >
              {t.priority}
            </span>
            <span
              className={`border-2 border-line ${pillPad[density]} font-bold uppercase ${
                t.status === "open"
                  ? "bg-emerald-400 text-black"
                  : t.status === "pending"
                    ? "bg-yellow-400 text-black"
                    : "bg-zinc-200 text-zinc-700"
              }`}
            >
              {t.status}
            </span>
            <span
              className={`${density === "compact" ? "text-[9px]" : "text-[11px]"} font-bold ${
                !t.assignee ? "text-red-600" : "text-muted"
              }`}
              title={t.assignee ?? "Unassigned"}
            >
              {formatAssignee(t.assignee)}
            </span>
            <span
              className={`${density === "compact" ? "text-[9px]" : "text-[11px]"} ${
                t.slaLabel.startsWith("BREACHED")
                  ? "font-bold text-red-600"
                  : "text-muted"
              }`}
            >
              {t.slaLabel}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
