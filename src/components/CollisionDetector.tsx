"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Viewer {
  userId: string;
  userName: string;
  activity: string;
}

export default function CollisionDetector({
  ticketId,
  currentUserId,
  currentUserName,
}: {
  ticketId: string;
  currentUserId?: string;
  currentUserName?: string;
}) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updatePresence = useCallback(async () => {
    if (!currentUserId) return;
    try {
      await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUserId,
          userName: currentUserName || "Agent",
          ticketId,
          activity: "viewing",
        }),
      });
    } catch {
      /* ignore */
    }
  }, [ticketId, currentUserId, currentUserName]);

  const fetchViewers = useCallback(async () => {
    try {
      const res = await fetch(`/api/presence?ticketId=${ticketId}`);
      const data = await res.json();
      setViewers(
        (data.viewers || []).filter((v: Viewer) => v.userId !== currentUserId)
      );
    } catch {
      /* ignore */
    }
  }, [ticketId, currentUserId]);

  useEffect(() => {
    updatePresence();
    fetchViewers();

    intervalRef.current = setInterval(() => {
      updatePresence();
      fetchViewers();
    }, 10_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Signal leave
      if (currentUserId) {
        fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: currentUserId, ticketId, action: "leave" }),
        }).catch(() => {});
      }
    };
  }, [ticketId, currentUserId, updatePresence, fetchViewers]);

  if (viewers.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-2 border-amber-400 bg-amber-50 px-4 py-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <span className="font-mono text-xs font-bold text-amber-800">
        {viewers.map((v) => v.userName).join(", ")}{" "}
        {viewers.length === 1 ? "is" : "are"} also{" "}
        {viewers.some((v) => v.activity === "typing") ? "typing" : "viewing"}{" "}
        this ticket
      </span>
    </div>
  );
}
