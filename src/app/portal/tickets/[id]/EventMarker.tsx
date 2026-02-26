"use client";

interface TicketEvent {
  id: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType: string;
  actorLabel?: string | null;
  note?: string | null;
  createdAt: string;
}

const dotColor: Record<string, string> = {
  opened: "bg-blue-500",
  replied: "bg-zinc-400",
  status_changed: "bg-amber-400",
  closed: "bg-zinc-500",
  reopened: "bg-emerald-500",
};

function eventText(event: TicketEvent): string {
  switch (event.eventType) {
    case "opened":
      return "Ticket opened";
    case "replied":
      return `${event.actorType === "customer" ? "Customer" : "Agent"} replied`;
    case "status_changed":
      return `Status changed${event.fromStatus ? ` from ${event.fromStatus}` : ""}${event.toStatus ? ` to ${event.toStatus}` : ""}`;
    case "closed":
      return "Ticket closed";
    case "reopened":
      return "Ticket reopened";
    default:
      return event.eventType;
  }
}

export default function EventMarker({ event }: { event: TicketEvent }) {
  return (
    <div className="flex items-center gap-3 px-6 py-3">
      <div className="flex-1 border-t border-zinc-200" />
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          dotColor[event.eventType] ?? "bg-zinc-300"
        }`}
      />
      <span className="shrink-0 font-mono text-xs text-zinc-500 uppercase">
        {eventText(event)}
      </span>
      <div className="flex-1 border-t border-zinc-200" />
    </div>
  );
}
