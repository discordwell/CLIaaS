"use client";

import { useEffect, useState, useRef } from "react";

interface ActivityEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export default function ActivityFeed({ maxEvents = 50 }: { maxEvents?: number }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as ActivityEvent;
        setEvents((prev) => [event, ...prev].slice(0, maxEvents));
      } catch {
        /* ignore */
      }
    };

    // Listen for all event types
    const types = [
      "ticket:created",
      "ticket:updated",
      "ticket:reply",
      "ticket:assigned",
      "ticket:status_changed",
      "presence:viewing",
      "presence:typing",
      "presence:left",
      "rule:executed",
      "notification",
    ];

    for (const type of types) {
      source.addEventListener(type, handleEvent);
    }

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [maxEvents]);

  const eventIcon: Record<string, string> = {
    "ticket:created": "+",
    "ticket:updated": "~",
    "ticket:reply": ">",
    "ticket:assigned": "@",
    "ticket:status_changed": "#",
    "presence:viewing": "o",
    "presence:typing": "...",
    "rule:executed": "!",
    notification: "*",
  };

  return (
    <div className="border-2 border-zinc-950 bg-white">
      <div className="flex items-center justify-between border-b-2 border-zinc-200 bg-zinc-50 px-4 py-2">
        <span className="font-mono text-xs font-bold uppercase text-zinc-500">
          Activity Feed
        </span>
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>
      <div className="max-h-96 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center font-mono text-xs text-zinc-400">
            No activity yet. Events will appear here in real time.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {events.map((event, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center bg-zinc-100 font-mono text-xs font-bold">
                  {eventIcon[event.type] ?? "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-zinc-700">
                    <span className="font-bold">{event.type}</span>
                    {typeof event.data.subject === "string" && (
                      <span className="ml-2 text-zinc-500">
                        {event.data.subject.slice(0, 60)}
                      </span>
                    )}
                    {typeof event.data.userName === "string" && (
                      <span className="ml-2 text-zinc-500">
                        by {event.data.userName}
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
