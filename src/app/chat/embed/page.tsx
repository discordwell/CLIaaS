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

type EmbedView = "button" | "prechat" | "chat";

// ---- Constants ----

const POLL_INTERVAL = 3000;
const API_BASE = "/api/chat";

// ---- Embed page (self-contained for iframe use) ----

export default function ChatEmbedPage() {
  const [view, setView] = useState<EmbedView>("button");
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

  // Notify parent about resize state
  function notifyParent(minimized: boolean) {
    try {
      window.parent.postMessage(
        { type: "cliaas-chat-resize", minimized },
        "*",
      );
    } catch {
      // Not in iframe
    }
  }

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
      // Network error
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
      notifyParent(false);

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
    notifyParent(true);
  }

  function handleOpen() {
    if (sessionId) {
      setView("chat");
    } else {
      setView("prechat");
    }
    notifyParent(false);
  }

  // Typing indicator
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInputChange(value: string) {
    setInput(value);

    if (!sessionId) return;

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

  // ---- Render: Floating button (minimized state) ----

  if (view === "button") {
    return (
      <div
        style={{
          position: "fixed",
          bottom: "16px",
          right: "16px",
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        }}
      >
        <button
          onClick={handleOpen}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            backgroundColor: "#09090b",
            color: "#fff",
            border: "2px solid #09090b",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
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

  // ---- Shared inline styles (for iframe isolation from host page CSS) ----

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    width: "360px",
    maxWidth: "calc(100vw - 32px)",
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontSize: "14px",
    lineHeight: "1.4",
    color: "#09090b",
    backgroundColor: "#fff",
    border: "2px solid #09090b",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    backgroundColor: "#09090b",
    color: "#fff",
    borderBottom: "2px solid #09090b",
    flexShrink: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    border: "2px solid #09090b",
    fontSize: "13px",
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  const buttonPrimaryStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 16px",
    backgroundColor: "#09090b",
    color: "#fff",
    border: "2px solid #09090b",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  const iconBtnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    background: "none",
    border: "none",
    color: "#a1a1aa",
    cursor: "pointer",
    padding: 0,
  };

  // ---- Render: Pre-chat form ----

  if (view === "prechat") {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <span style={labelStyle}>Live Chat</span>
          <button onClick={handleMinimize} style={iconBtnStyle} title="Close">
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

        <form
          onSubmit={handleStartChat}
          style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <p style={{ fontSize: "13px", color: "#52525b", margin: 0 }}>
            Start a conversation with our team.
          </p>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "4px",
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "#71717a",
                letterSpacing: "0.05em",
              }}
            >
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
              autoFocus
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "4px",
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "#71717a",
                letterSpacing: "0.05em",
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>

          {formError && (
            <p style={{ fontSize: "11px", color: "#dc2626", margin: 0, fontFamily: "inherit" }}>
              {formError}
            </p>
          )}

          <button type="submit" style={buttonPrimaryStyle}>
            Start Chat
          </button>
        </form>
      </div>
    );
  }

  // ---- Render: Chat window ----

  return (
    <div
      style={{
        ...containerStyle,
        height: "520px",
        maxHeight: "calc(100vh - 32px)",
      }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={labelStyle}>Live Chat</span>
          <span
            style={{
              display: "inline-block",
              width: "8px",
              height: "8px",
              backgroundColor:
                status === "active"
                  ? "#4ade80"
                  : status === "waiting"
                    ? "#fbbf24"
                    : "#71717a",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {status !== "closed" && (
            <button
              onClick={handleCloseChat}
              style={{
                ...iconBtnStyle,
                width: "auto",
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                padding: "2px 8px",
                fontFamily: "inherit",
              }}
              title="End chat"
            >
              End
            </button>
          )}
          <button onClick={handleMinimize} style={iconBtnStyle} title="Minimize">
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
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
        }}
      >
        {messages.map((msg) => {
          const isCustomer = msg.role === "customer";
          const isSystem = msg.role === "system";

          return (
            <div
              key={msg.id}
              style={{
                marginBottom: "12px",
                display: "flex",
                flexDirection: "column",
                alignItems: isCustomer
                  ? "flex-end"
                  : isSystem
                    ? "center"
                    : "flex-start",
              }}
            >
              {isSystem ? (
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "4px 12px",
                    textAlign: "center",
                    fontSize: "10px",
                    color: "#a1a1aa",
                  }}
                >
                  {msg.body}
                </div>
              ) : (
                <>
                  <div
                    style={{
                      marginBottom: "2px",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase" as const,
                      color: "#a1a1aa",
                    }}
                  >
                    {isCustomer ? "You" : "Agent"}
                  </div>
                  <div
                    style={{
                      maxWidth: "85%",
                      border: "2px solid",
                      borderColor: isCustomer ? "#09090b" : "#d4d4d8",
                      backgroundColor: isCustomer ? "#09090b" : "#fafafa",
                      color: isCustomer ? "#fff" : "#09090b",
                      padding: "8px 12px",
                      fontSize: "13px",
                    }}
                  >
                    {msg.body}
                  </div>
                  <div
                    style={{
                      marginTop: "2px",
                      fontSize: "10px",
                      color: "#d4d4d8",
                    }}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {agentTyping && (
          <div
            style={{
              marginBottom: "12px",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                marginBottom: "2px",
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                color: "#a1a1aa",
              }}
            >
              Agent
            </div>
            <div
              style={{
                border: "2px solid #d4d4d8",
                backgroundColor: "#fafafa",
                padding: "8px 12px",
                display: "flex",
                gap: "4px",
                alignItems: "center",
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    backgroundColor: "#a1a1aa",
                    animation: `embed-bounce 0.6s ${i * 0.15}s infinite alternate`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Closed state */}
        {status === "closed" && (
          <div
            style={{
              margin: "16px 0",
              border: "2px solid #e4e4e7",
              backgroundColor: "#fafafa",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                color: "#71717a",
                margin: "0 0 4px 0",
              }}
            >
              Chat Ended
            </p>
            <p style={{ fontSize: "11px", color: "#a1a1aa", margin: 0 }}>
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
          style={{
            display: "flex",
            borderTop: "2px solid #09090b",
            flexShrink: 0,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Type a message..."
            style={{
              flex: 1,
              padding: "12px 16px",
              border: "none",
              outline: "none",
              fontSize: "13px",
              fontFamily: "inherit",
            }}
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            style={{
              backgroundColor: !input.trim() || sending ? "#a1a1aa" : "#09090b",
              color: "#fff",
              padding: "12px 16px",
              border: "none",
              borderLeft: "2px solid #09090b",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase" as const,
              cursor: !input.trim() || sending ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Send
          </button>
        </form>
      ) : (
        <div
          style={{
            borderTop: "2px solid #09090b",
            padding: "12px",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              setSessionId(null);
              setMessages([]);
              setStatus("waiting");
              lastTimestampRef.current = 0;
              setView("prechat");
              notifyParent(false);
            }}
            style={buttonPrimaryStyle}
          >
            Start New Chat
          </button>
        </div>
      )}

      {/* Keyframes for typing animation */}
      <style>{`
        @keyframes embed-bounce {
          0% { transform: translateY(0); }
          100% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
