"use client";

import { useState, useEffect, useCallback } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationBellProps {
  /** "default" = white topbar styling, "sidebar" = dark sidebar styling */
  variant?: "default" | "sidebar";
  /** When true, show icon only (no label) — used in collapsed sidebar */
  collapsed?: boolean;
}

export default function NotificationBell({ variant = "default", collapsed = false }: NotificationBellProps = {}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=true");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Polling failure — ignore
    }
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Also listen for SSE notification events
  useEffect(() => {
    const es = new EventSource("/api/events");
    const handler = () => {
      fetchNotifications();
    };
    es.addEventListener("notification", handler);
    return () => {
      es.removeEventListener("notification", handler);
      es.close();
    };
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/notifications/${id}`, { method: "PATCH" });
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // Ignore
      }
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  }, []);

  const isSidebar = variant === "sidebar";

  const bellIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 flex-shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zM8.05 14.943a33.54 33.54 0 003.9 0 2 2 0 01-3.9 0z"
        clipRule="evenodd"
      />
    </svg>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={
          isSidebar
            ? `relative flex items-center gap-2.5 font-mono text-xs transition-colors ${
                collapsed ? "justify-center" : ""
              } text-zinc-500 hover:text-white`
            : "relative px-2 py-1 font-mono text-xs font-bold uppercase text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
        }
        title={collapsed ? "Notifications" : undefined}
      >
        {bellIcon}
        {isSidebar && !collapsed && <span>Notifications</span>}
        {unreadCount > 0 && (
          <span
            className={
              isSidebar
                ? "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[10px] font-bold text-white"
                : "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center bg-red-500 px-1 font-mono text-[10px] font-bold text-white"
            }
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={
            isSidebar
              ? "absolute bottom-full left-0 z-50 mb-1 w-80 border border-zinc-700 bg-zinc-900 shadow-lg"
              : "absolute right-0 top-full z-50 mt-1 w-80 border-2 border-zinc-950 bg-white shadow-lg"
          }
        >
          <div
            className={
              isSidebar
                ? "flex items-center justify-between border-b border-zinc-700 p-3"
                : "flex items-center justify-between border-b border-zinc-200 p-3"
            }
          >
            <span
              className={
                isSidebar
                  ? "font-mono text-xs font-bold uppercase text-zinc-400"
                  : "font-mono text-xs font-bold uppercase text-zinc-500"
              }
            >
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className={
                  isSidebar
                    ? "font-mono text-[10px] font-bold text-zinc-400 hover:text-white"
                    : "font-mono text-[10px] font-bold text-zinc-500 hover:text-zinc-950"
                }
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div
                className={
                  isSidebar
                    ? "p-4 text-center font-mono text-xs text-zinc-500"
                    : "p-4 text-center font-mono text-xs text-zinc-400"
                }
              >
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <a
                  key={n.id}
                  href={
                    n.resourceType === "ticket" && n.resourceId
                      ? `/tickets/${n.resourceId}`
                      : "#"
                  }
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                    setIsOpen(false);
                  }}
                  className={
                    isSidebar
                      ? `block border-b border-zinc-800 p-3 transition-colors hover:bg-zinc-800 ${
                          !n.read ? "bg-zinc-800/50" : ""
                        }`
                      : `block border-b border-zinc-100 p-3 transition-colors hover:bg-zinc-50 ${
                          !n.read ? "bg-amber-50/40" : ""
                        }`
                  }
                >
                  <div className="flex items-start gap-2">
                    {!n.read && (
                      <span
                        className={
                          isSidebar
                            ? "mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400"
                            : "mt-1 h-2 w-2 flex-shrink-0 bg-amber-400"
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          isSidebar
                            ? "font-mono text-xs font-bold text-zinc-200"
                            : "font-mono text-xs font-bold text-zinc-900"
                        }
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
