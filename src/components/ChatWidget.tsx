"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ---- Types ----

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

type WidgetView = "button" | "prechat" | "chat";

// ---- Constants ----

const POLL_INTERVAL = 3000;
const API_BASE = "/api/chat";

// ---- Component ----

export default function ChatWidget() {
  const [view, setView] = useState<WidgetView>("button");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"waiting" | "active" | "closed">(
    "waiting",
  );
  const [agentTyping, setAgentTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTimestampRef = useRef<number>(0);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll for new messages
  const pollMessages = useCallback(async () => {
    if (!sessionId) return;

    try {
      const after = lastTimestampRef.current || 0;
      const res = await fetch(
        `${API_BASE}?sessionId=${sessionId}&after=${after}`,
      );
      if (!res.ok) return;

      const data: PollResponse = await res.json();
      setStatus(data.status);
      setAgentTyping(data.agentTyping);

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
      // Network error, will retry on next poll
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || status === "closed") return;

    const interval = setInterval(pollMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [sessionId, status, pollMessages]);

  // ---- Handlers ----

  async function handleStartChat(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    const trimName = name.trim();
    const trimEmail = email.trim();

    if (!trimName || !trimEmail) {
      setFormError("Name and email are required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      setFormError("Please enter a valid email address.");
      return;
    }

    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          customerName: trimName,
          customerEmail: trimEmail,
        }),
      });

      if (!res.ok) {
        setFormError("Failed to start chat. Please try again.");
        return;
      }

      const data = await res.json();
      setSessionId(data.sessionId);
      setMessages(data.messages || []);
      setView("chat");

      // Set initial timestamp so we only poll for newer messages
      if (data.messages?.length > 0) {
        lastTimestampRef.current = Math.max(
          ...data.messages.map((m: ChatMessage) => m.timestamp),
        );
      }

      setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      setFormError("Connection error. Please try again.");
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || !sessionId || sending) return;

    setSending(true);
    setInput("");

    // Optimistic update
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sessionId,
      role: "customer",
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
          sessionId,
          role: "customer",
          body,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Replace optimistic message with server response
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? data.message : m)),
        );
        lastTimestampRef.current = data.message.timestamp;
      }
    } catch {
      // Keep optimistic message, it will be deduplicated on next poll
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleCloseChat() {
    if (!sessionId) return;

    try {
      await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          sessionId,
          createTicket: true,
        }),
      });
    } catch {
      // Best effort
    }

    setStatus("closed");
  }

  function handleMinimize() {
    setView("button");
    // Notify parent iframe if embedded
    try {
      window.parent.postMessage(
        { type: "cliaas-chat-resize", minimized: true },
        "*",
      );
    } catch {
      // Not in iframe
    }
  }

  function handleOpen() {
    if (sessionId) {
      setView("chat");
    } else {
      setView("prechat");
    }
    // Notify parent iframe if embedded
    try {
      window.parent.postMessage(
        { type: "cliaas-chat-resize", minimized: false },
        "*",
      );
    } catch {
      // Not in iframe
    }
  }

  // Send typing indicator (debounced)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInputChange(value: string) {
    setInput(value);

    if (!sessionId) return;

    // Send typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "typing",
        sessionId,
        role: "customer",
        typing: true,
      }),
    }).catch(() => {});

    typingTimeoutRef.current = setTimeout(() => {
      fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "typing",
          sessionId,
          role: "customer",
          typing: false,
        }),
      }).catch(() => {});
    }, 2000);
  }

  // ---- Render: Floating button ----

  if (view === "button") {
    return (
      <div className="fixed bottom-6 right-6 z-[9999]">
        <button
          onClick={handleOpen}
          className="flex h-14 w-14 items-center justify-center border-2 border-zinc-950 bg-zinc-950 text-white shadow-lg transition-colors hover:bg-zinc-800"
          title="Open chat"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    );
  }

  // ---- Render: Pre-chat form ----

  if (view === "prechat") {
    return (
      <div className="fixed bottom-6 right-6 z-[9999] flex w-[360px] max-w-[calc(100vw-48px)] flex-col border-2 border-zinc-950 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-zinc-950 bg-zinc-950 px-4 py-3 text-white">
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            Live Chat
          </span>
          <button
            onClick={handleMinimize}
            className="flex h-6 w-6 items-center justify-center text-zinc-400 transition-colors hover:text-white"
            title="Minimize"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
            >
              <path d="M1 13L13 1M1 1l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleStartChat} className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-sm font-medium text-zinc-700">
              Start a conversation with our team.
            </p>
          </div>

          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full border-2 border-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-300"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase text-zinc-500">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border-2 border-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-300"
            />
          </div>

          {formError && (
            <p className="font-mono text-xs text-red-600">{formError}</p>
          )}

          <button
            type="submit"
            className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2.5 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800"
          >
            Start Chat
          </button>
        </form>
      </div>
    );
  }

  // ---- Render: Chat window ----

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex h-[520px] w-[360px] max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] flex-col border-2 border-zinc-950 bg-white shadow-xl">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b-2 border-zinc-950 bg-zinc-950 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            Live Chat
          </span>
          <span
            className={`inline-block h-2 w-2 ${
              status === "active"
                ? "bg-emerald-400"
                : status === "waiting"
                  ? "bg-amber-400"
                  : "bg-zinc-500"
            }`}
            title={status}
          />
        </div>
        <div className="flex items-center gap-1">
          {status !== "closed" && (
            <button
              onClick={handleCloseChat}
              className="px-2 py-1 font-mono text-[10px] font-bold uppercase text-zinc-400 transition-colors hover:text-red-400"
              title="End chat"
            >
              End
            </button>
          )}
          <button
            onClick={handleMinimize}
            className="flex h-6 w-6 items-center justify-center text-zinc-400 transition-colors hover:text-white"
            title="Minimize"
          >
            <svg
              width="12"
              height="2"
              viewBox="0 0 12 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
            >
              <path d="M1 1h10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 ${
              msg.role === "customer"
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
                  {msg.role === "customer" ? "You" : "Agent"}
                </div>
                <div
                  className={`max-w-[85%] border-2 px-3 py-2 text-sm ${
                    msg.role === "customer"
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

        {/* Typing indicator */}
        {agentTyping && (
          <div className="mb-3 flex flex-col items-start">
            <div className="mb-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
              Agent
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

        {/* Closed state */}
        {status === "closed" && (
          <div className="my-4 border-2 border-zinc-200 bg-zinc-50 p-4 text-center">
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Chat Ended
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              A ticket has been created from this conversation.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {status !== "closed" ? (
        <form
          onSubmit={handleSendMessage}
          className="flex shrink-0 border-t-2 border-zinc-950"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 text-sm outline-none placeholder:text-zinc-400"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="border-l-2 border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          >
            Send
          </button>
        </form>
      ) : (
        <div className="shrink-0 border-t-2 border-zinc-950 p-3 text-center">
          <button
            onClick={() => {
              setSessionId(null);
              setMessages([]);
              setStatus("waiting");
              lastTimestampRef.current = 0;
              setView("prechat");
            }}
            className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800"
          >
            Start New Chat
          </button>
        </div>
      )}
    </div>
  );
}
