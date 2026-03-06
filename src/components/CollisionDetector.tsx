"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Viewer {
  userId: string;
  userName: string;
  activity: string;
}

export default function CollisionDetector({
  ticketId,
}: {
  ticketId: string;
}) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Register presence on mount (single POST to get userId + initial viewers)
  const registerPresence = useCallback(async () => {
    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, activity: "viewing" }),
      });
      const data = await res.json();
      if (data.currentUserId) setCurrentUserId(data.currentUserId);
      if (data.viewers) {
        setViewers(
          (data.viewers as Viewer[]).filter(
            (v) => v.userId !== data.currentUserId
          )
        );
      }
    } catch {
      /* ignore */
    }
  }, [ticketId]);

  useEffect(() => {
    // Register presence initially
    void registerPresence();

    // Connect to SSE for real-time presence updates
    const es = new EventSource(
      `/api/events?ticketId=${encodeURIComponent(ticketId)}`
    );

    const handleViewing = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        const { userId, userName } = event.data ?? {};
        if (!userId || userId === currentUserId) return;
        setViewers((prev) => {
          const existing = prev.find((v) => v.userId === userId);
          if (existing) {
            return prev.map((v) =>
              v.userId === userId ? { ...v, activity: "viewing" } : v
            );
          }
          return [...prev, { userId, userName: userName ?? "Agent", activity: "viewing" }];
        });
      } catch { /* ignore */ }
    };

    const handleTyping = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        const { userId, userName } = event.data ?? {};
        if (!userId || userId === currentUserId) return;
        setViewers((prev) => {
          const existing = prev.find((v) => v.userId === userId);
          if (existing) {
            return prev.map((v) =>
              v.userId === userId ? { ...v, activity: "typing" } : v
            );
          }
          return [...prev, { userId, userName: userName ?? "Agent", activity: "typing" }];
        });
      } catch { /* ignore */ }
    };

    const handleLeft = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        const { userId } = event.data ?? {};
        if (!userId) return;
        setViewers((prev) => prev.filter((v) => v.userId !== userId));
      } catch { /* ignore */ }
    };

    es.addEventListener("presence:viewing", handleViewing);
    es.addEventListener("presence:typing", handleTyping);
    es.addEventListener("presence:left", handleLeft);

    // Heartbeat: re-register presence every 30s to keep server-side presence alive
    const heartbeat = setInterval(() => void registerPresence(), 30_000);

    return () => {
      es.removeEventListener("presence:viewing", handleViewing);
      es.removeEventListener("presence:typing", handleTyping);
      es.removeEventListener("presence:left", handleLeft);
      es.close();
      clearInterval(heartbeat);
      // Signal leave via sendBeacon to survive page unload
      const payload = new Blob(
        [JSON.stringify({ ticketId, action: "leave" })],
        { type: "application/json" }
      );
      navigator.sendBeacon("/api/presence", payload);
    };
  }, [ticketId, currentUserId, registerPresence]);

  if (viewers.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-2 border-amber-400 bg-amber-50 px-4 py-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <div className="flex items-center gap-2">
        {viewers.map((v) => (
          <span
            key={v.userId}
            className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 font-mono text-xs font-bold text-amber-800"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">
              {v.userName.charAt(0).toUpperCase()}
            </span>
            {v.userName}
            {v.activity === "typing" ? (
              <svg className="h-3 w-3 animate-pulse" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="2" cy="6" r="1.5" />
                <circle cx="6" cy="6" r="1.5" />
                <circle cx="10" cy="6" r="1.5" />
              </svg>
            ) : (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 2C3.5 2 1.4 3.6.5 6c.9 2.4 3 4 5.5 4s4.6-1.6 5.5-4C10.6 3.6 8.5 2 6 2zm0 6.5C4.6 8.5 3.5 7.4 3.5 6S4.6 3.5 6 3.5 8.5 4.6 8.5 6 7.4 8.5 6 8.5zM6 5a1 1 0 100 2 1 1 0 000-2z" />
              </svg>
            )}
          </span>
        ))}
        <span className="font-mono text-xs font-bold text-amber-800">
          {viewers.length === 1 ? "is" : "are"} also on this ticket
        </span>
      </div>
    </div>
  );
}
