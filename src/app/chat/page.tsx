"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// ---- Types ----

interface SessionSummary {
  id: string;
  customerName: string;
  customerEmail: string;
  status: "waiting" | "active" | "closed";
  lastMessage: string | null;
  messageCount: number;
  startedAt: number;
  lastActivity: number;
  customerTyping: boolean;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: "customer" | "agent" | "system";
  body: string;
  timestamp: number;
}

interface PollResponse {
  sessionId: string;
  status: "waiting" | "active" | "closed";
  agentTyping: boolean;
  customerTyping: boolean;
  messages: ChatMessage[];
}

// ---- Constants ----

const POLL_INTERVAL = 3000;
const API_BASE = "/api/chat";

// ---- Status badge ----

const statusStyles: Record<string, string> = {
  waiting: "bg-amber-300 text-black",
  active: "bg-emerald-400 text-black",
  closed: "bg-zinc-400 text-white",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusStyles[status] ?? "bg-zinc-200 text-black"}`}
    >
      {status}
    </span>
  );
}

// ---- Page ----

export default function AgentChatDashboard() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string>("waiting");
  const [customerTyping, setCustomerTyping] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTimestampRef = useRef<number>(0);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---- Poll sessions ----

  const pollSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chat/sessions${showClosed ? "?all=true" : ""}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions);
    } catch {
      // Network error
    }
  }, [showClosed]);

  useEffect(() => {
    pollSessions();
    const interval = setInterval(pollSessions, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [pollSessions]);

  // ---- Poll active session messages ----

  const pollMessages = useCallback(async () => {
    if (!activeSessionId) return;

    try {
      const after = lastTimestampRef.current || 0;
      const res = await fetch(
        `${API_BASE}?sessionId=${activeSessionId}&after=${after}`,
      );
      if (!res.ok) return;

      const data: PollResponse = await res.json();
      setSessionStatus(data.status);
      setCustomerTyping(data.customerTyping);

      if (data.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;

          const maxTs = Math.max(...newMsgs.map((m) => m.timestamp));
          if (maxTs > lastTimestampRef.current) {
            lastTimestampRef.current = maxTs;
          }
          return [...prev, ...newMsgs];
        });
      }
    } catch {
      // Network error
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;

    // Load full message history on session switch
    lastTimestampRef.current = 0;
    setMessages([]);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}?sessionId=${activeSessionId}`);
        if (!res.ok) return;
        const data: PollResponse = await res.json();
        setMessages(data.messages);
        setSessionStatus(data.status);
        setCustomerTyping(data.customerTyping);

        if (data.messages.length > 0) {
          lastTimestampRef.current = Math.max(
            ...data.messages.map((m) => m.timestamp),
          );
        }
      } catch {
        // Network error
      }
    })();

    const interval = setInterval(pollMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [activeSessionId, pollMessages]);

  // ---- Send message ----

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || !activeSessionId || sending) return;

    setSending(true);
    setInput("");

    // Optimistic update
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sessionId: activeSessionId,
      role: "agent",
      body,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          sessionId: activeSessionId,
          role: "agent",
          body,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? data.message : m)),
        );
        lastTimestampRef.current = data.message.timestamp;
      }
    } catch {
      // Keep optimistic
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  // ---- Close session ----

  async function handleCloseSession() {
    if (!activeSessionId) return;

    try {
      await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          sessionId: activeSessionId,
          createTicket: true,
        }),
      });

      setSessionStatus("closed");
      pollSessions();
    } catch {
      // Best effort
    }
  }

  // ---- Send typing indicator ----

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInputChange(value: string) {
    setInput(value);

    if (!activeSessionId) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "typing",
        sessionId: activeSessionId,
        role: "agent",
        typing: true,
      }),
    }).catch(() => {});

    typingTimeoutRef.current = setTimeout(() => {
      fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "typing",
          sessionId: activeSessionId,
          role: "agent",
          typing: false,
        }),
      }).catch(() => {});
    }, 2000);
  }

  // ---- Active session info ----

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Agent Console
            </p>
            <h1 className="mt-2 text-3xl font-bold">Live Chat</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Dashboard
            </Link>
            <Link
              href="/tickets"
              className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Tickets
            </Link>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="mt-8 grid gap-0 lg:grid-cols-[320px_1fr]">
        {/* Session list */}
        <div className="border-2 border-zinc-950 bg-white lg:border-r-0">
          <div className="flex items-center justify-between border-b-2 border-zinc-200 bg-zinc-50 px-4 py-3">
            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
              Sessions ({sessions.length})
            </span>
            <button
              onClick={() => setShowClosed(!showClosed)}
              className={`font-mono text-[10px] font-bold uppercase transition-colors ${
                showClosed
                  ? "text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {showClosed ? "Hide Closed" : "Show Closed"}
            </button>
          </div>

          <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-zinc-400">
                No active chat sessions.
                <br />
                Waiting for customers...
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setActiveSessionId(s.id)}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-zinc-50 ${
                        activeSessionId === s.id
                          ? "border-l-4 border-l-zinc-950 bg-zinc-50"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">
                          {s.customerName}
                        </span>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                        {s.customerEmail}
                      </p>
                      {s.lastMessage && (
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {s.lastMessage}
                        </p>
                      )}
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-zinc-300">
                          {new Date(s.lastActivity).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {s.customerTyping && (
                          <span className="font-mono text-[10px] text-amber-500">
                            typing...
                          </span>
                        )}
                        {s.messageCount > 0 && (
                          <span className="font-mono text-[10px] text-zinc-300">
                            {s.messageCount} msgs
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Chat pane */}
        <div className="flex flex-col border-2 border-zinc-950 bg-white">
          {activeSessionId && activeSession ? (
            <>
              {/* Chat header */}
              <div className="flex shrink-0 items-center justify-between border-b-2 border-zinc-200 bg-zinc-50 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">
                      {activeSession.customerName}
                    </span>
                    <StatusBadge status={sessionStatus} />
                  </div>
                  <p className="font-mono text-[10px] text-zinc-400">
                    {activeSession.customerEmail}
                    {" \u00b7 "}
                    Started{" "}
                    {new Date(activeSession.startedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {sessionStatus !== "closed" && (
                  <button
                    onClick={handleCloseSession}
                    className="border-2 border-red-300 bg-white px-3 py-1 font-mono text-xs font-bold uppercase text-red-600 transition-colors hover:bg-red-50"
                  >
                    Close
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3" style={{ minHeight: "400px" }}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`mb-3 ${
                      msg.role === "agent"
                        ? "flex flex-col items-end"
                        : msg.role === "system"
                          ? "flex flex-col items-center"
                          : "flex flex-col items-start"
                    }`}
                  >
                    {msg.role === "system" ? (
                      <div className="max-w-[85%] px-3 py-1.5 text-center font-mono text-[10px] text-zinc-400">
                        {msg.body}
                      </div>
                    ) : (
                      <>
                        <div className="mb-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
                          {msg.role === "agent" ? "You" : activeSession.customerName}
                        </div>
                        <div
                          className={`max-w-[85%] border-2 px-3 py-2 text-sm ${
                            msg.role === "agent"
                              ? "border-zinc-950 bg-zinc-950 text-white"
                              : "border-zinc-300 bg-zinc-50 text-zinc-900"
                          }`}
                        >
                          {msg.body}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-zinc-300">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ))}

                {/* Customer typing indicator */}
                {customerTyping && (
                  <div className="mb-3 flex flex-col items-start">
                    <div className="mb-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
                      {activeSession.customerName}
                    </div>
                    <div className="border-2 border-zinc-300 bg-zinc-50 px-3 py-2">
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce bg-zinc-400 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce bg-zinc-400 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce bg-zinc-400 [animation-delay:300ms]" />
                      </span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Agent input */}
              {sessionStatus !== "closed" ? (
                <form
                  onSubmit={handleSend}
                  className="flex shrink-0 border-t-2 border-zinc-950"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => handleInputChange(e.target.value)}
                    placeholder="Type a reply..."
                    className="flex-1 px-4 py-3 text-sm outline-none placeholder:text-zinc-400"
                    disabled={sending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="border-l-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  >
                    Send
                  </button>
                </form>
              ) : (
                <div className="shrink-0 border-t-2 border-zinc-200 bg-zinc-50 p-4 text-center">
                  <p className="font-mono text-xs text-zinc-500">
                    This chat session has been closed. A ticket was created.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8" style={{ minHeight: "400px" }}>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border-2 border-zinc-200">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="square"
                    className="text-zinc-300"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="font-mono text-xs font-bold uppercase text-zinc-400">
                  Select a session
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Choose a chat from the left panel to start responding.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Embed snippet section */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-lg font-bold text-white">Embed Chat Widget</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Add this script to your website to enable live chat:
        </p>
        <pre className="mt-4 overflow-x-auto bg-zinc-900 p-4 font-mono text-sm text-emerald-400">
          {`<script src="${typeof window !== 'undefined' ? window.location.origin : 'https://cliaas.com'}/api/chat/widget.js"></script>`}
        </pre>
      </section>
    </main>
  );
}
