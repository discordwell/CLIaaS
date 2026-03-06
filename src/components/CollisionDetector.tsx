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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updatePresence = useCallback(async () => {
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
    const initialTimer = setTimeout(() => void updatePresence(), 0);
    intervalRef.current = setInterval(() => void updatePresence(), 10_000);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Signal leave — use sendBeacon to survive page unload
      const payload = new Blob(
        [JSON.stringify({ ticketId, action: "leave" })],
        { type: "application/json" },
      );
      navigator.sendBeacon("/api/presence", payload);
    };
  }, [ticketId, updatePresence]);

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
