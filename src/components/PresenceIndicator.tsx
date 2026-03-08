"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface PresenceEntry {
  userId: string;
  userName: string;
  status: "viewing" | "replying";
  since: string;
}

interface PresenceIndicatorProps {
  ticketId: string;
  /** When true, the current user is typing a reply. Sends 'replying' status in heartbeat. */
  isReplying?: boolean;
  /** Callback fired when another user is detected as replying. */
  onCollisionDetected?: (replyingUsers: PresenceEntry[]) => void;
}

const POLL_INTERVAL_MS = 5_000; // Poll every 5 seconds
const HEARTBEAT_INTERVAL_MS = 10_000; // Heartbeat every 10 seconds

export default function PresenceIndicator({
  ticketId,
  isReplying = false,
  onCollisionDetected,
}: PresenceIndicatorProps) {
  const [viewers, setViewers] = useState<PresenceEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tooltipTarget, setTooltipTarget] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isReplyingRef = useRef(isReplying);
  const mountedRef = useRef(true);

  // Keep ref in sync with prop
  useEffect(() => {
    isReplyingRef.current = isReplying;
  }, [isReplying]);

  // Send heartbeat POST to register/maintain presence
  const sendHeartbeat = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: isReplyingRef.current ? "replying" : "viewing",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.currentUserId && mountedRef.current) {
          setCurrentUserId(data.currentUserId);
        }
      }
    } catch {
      // Network error — ignore
    }
  }, [ticketId]);

  // Poll GET to fetch current viewers
  const pollPresence = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/presence`);
      if (!res.ok || !mountedRef.current) return;

      const data = await res.json();
      if (data.currentUserId) setCurrentUserId(data.currentUserId);

      const others = (data.viewers as PresenceEntry[]).filter(
        (v) => v.userId !== data.currentUserId,
      );
      setViewers(others);

      // Check for collision — other users replying
      const replyingOthers = others.filter((v) => v.status === "replying");
      if (replyingOthers.length > 0 && onCollisionDetected) {
        onCollisionDetected(replyingOthers);
      }
    } catch {
      // Network error — ignore
    }
  }, [ticketId, onCollisionDetected]);

  // Unregister presence
  const unregister = useCallback(() => {
    // sendBeacon can't send DELETE, so we use the legacy presence endpoint for page unload
    navigator.sendBeacon(
      `/api/presence`,
      new Blob(
        [JSON.stringify({ ticketId, action: "leave" })],
        { type: "application/json" },
      ),
    );
    // Also try DELETE (won't work on unload, but works for normal unmount)
    fetch(`/api/tickets/${encodeURIComponent(ticketId)}/presence`, {
      method: "DELETE",
    }).catch(() => {});
  }, [ticketId]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial heartbeat + poll
    void sendHeartbeat();
    void pollPresence();

    // Set up intervals
    heartbeatRef.current = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    pollRef.current = setInterval(() => void pollPresence(), POLL_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      unregister();
    };
  }, [ticketId, sendHeartbeat, pollPresence, unregister]);

  // Register beforeunload for cleanup
  useEffect(() => {
    const handleBeforeUnload = () => unregister();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [unregister]);

  if (viewers.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {viewers.map((v) => (
        <div
          key={v.userId}
          className="group relative"
          onMouseEnter={() => setTooltipTarget(v.userId)}
          onMouseLeave={() => setTooltipTarget(null)}
        >
          {/* Avatar initial with status dot */}
          <div className="relative">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold text-white ${
                v.status === "replying"
                  ? "bg-red-600 ring-2 ring-red-300"
                  : "bg-amber-500 ring-2 ring-amber-200"
              }`}
            >
              {v.userName.charAt(0).toUpperCase()}
            </span>
            {/* Status dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white ${
                v.status === "replying" ? "bg-red-500" : "bg-amber-400"
              }`}
            >
              {v.status === "replying" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              )}
            </span>
          </div>

          {/* Tooltip */}
          {tooltipTarget === v.userId && (
            <div className="absolute -top-10 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-white shadow-lg">
              {v.userName} &mdash; {v.status}
              <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Compact presence dot for ticket list rows.
 * Shows a single dot indicating someone is on the ticket.
 */
export function PresenceDot({
  viewers,
}: {
  viewers: PresenceEntry[];
}) {
  if (viewers.length === 0) return null;

  const hasReplying = viewers.some((v) => v.status === "replying");
  const names = viewers.map((v) => v.userName).join(", ");

  return (
    <span
      className="group relative inline-flex items-center"
      title={`${names} ${viewers.length === 1 ? "is" : "are"} ${hasReplying ? "replying" : "viewing"}`}
    >
      <span className="relative flex h-2.5 w-2.5">
        {hasReplying && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            hasReplying ? "bg-red-500" : "bg-amber-400"
          }`}
        />
      </span>
    </span>
  );
}
