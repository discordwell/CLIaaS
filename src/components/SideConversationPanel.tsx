"use client";

import { useState, useEffect, useCallback } from "react";

interface SideConversation {
  id: string;
  subject: string | null;
  externalEmail: string | null;
  status: string;
  createdAt: string;
  messageCount: number;
}

interface SideMessage {
  id: string;
  author: string;
  authorType: string;
  body: string;
  createdAt: string;
}

interface SideConversationPanelProps {
  ticketId: string;
}

export default function SideConversationPanel({
  ticketId,
}: SideConversationPanelProps) {
  const [conversations, setConversations] = useState<SideConversation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SideMessage[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);

  // Create form
  const [newSubject, setNewSubject] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBody, setNewBody] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [createState, setCreateState] = useState<
    "idle" | "creating" | "success" | "error"
  >("idle");

  // Reply form
  const [replyBody, setReplyBody] = useState("");
  const [replySendEmail, setReplySendEmail] = useState(false);
  const [replyState, setReplyState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/side-conversations`,
      );
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations ?? []);
      }
    } catch {
      // Ignore
    }
  }, [ticketId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadMessages = useCallback(
    async (scId: string) => {
      try {
        const res = await fetch(
          `/api/tickets/${ticketId}/side-conversations/${scId}`,
        );
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages ?? []);
        }
      } catch {
        setMessages([]);
      }
    },
    [ticketId],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setMessages([]);
      } else {
        setExpandedId(id);
        loadMessages(id);
      }
    },
    [expandedId, loadMessages],
  );

  const handleCreate = async () => {
    if (!newSubject.trim() || !newBody.trim()) return;
    setCreateState("creating");
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/side-conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: newSubject,
            body: newBody,
            externalEmail: newEmail || undefined,
            sendEmail,
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to create");
      setNewSubject("");
      setNewEmail("");
      setNewBody("");
      setSendEmail(false);
      setShowCreate(false);
      setCreateState("idle");
      fetchConversations();
    } catch {
      setCreateState("error");
    }
  };

  const handleReply = async () => {
    if (!expandedId || !replyBody.trim()) return;
    setReplyState("sending");
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/side-conversations/${expandedId}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: replyBody,
            sendEmail: replySendEmail,
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to reply");
      setReplyBody("");
      setReplySendEmail(false);
      setReplyState("idle");
      loadMessages(expandedId);
    } catch {
      setReplyState("error");
    }
  };

  const handleStatusToggle = async (scId: string, currentStatus: string) => {
    const newStatus = currentStatus === "open" ? "closed" : "open";
    try {
      await fetch(
        `/api/tickets/${ticketId}/side-conversations/${scId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      fetchConversations();
    } catch {
      // Ignore
    }
  };

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white">
      <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
        <h3 className="text-lg font-bold">
          Side Conversations ({conversations.length})
        </h3>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          {showCreate ? "Cancel" : "New"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border-b border-zinc-200 bg-zinc-50 p-6">
          <div className="space-y-3">
            <input
              type="text"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="Subject"
              className="w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="External email (optional)"
              className="w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <textarea
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Message..."
              rows={3}
              className="w-full border-2 border-zinc-300 p-3 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-mono text-xs font-bold text-zinc-600">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="h-4 w-4"
                />
                Send email to external party
              </label>
              <button
                type="button"
                onClick={handleCreate}
                disabled={
                  createState === "creating" ||
                  !newSubject.trim() ||
                  !newBody.trim()
                }
                className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {createState === "creating" ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conversation list */}
      {conversations.length === 0 && !showCreate ? (
        <div className="p-6 text-center font-mono text-xs text-zinc-400">
          No side conversations yet
        </div>
      ) : (
        <div className="divide-y divide-zinc-200">
          {conversations.map((sc) => (
            <div key={sc.id}>
              <button
                type="button"
                onClick={() => toggleExpand(sc.id)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-zinc-50"
              >
                <div>
                  <p className="text-sm font-bold">
                    {sc.subject || "Untitled"}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                    {sc.externalEmail || "Internal only"} &middot;{" "}
                    {sc.messageCount} message(s) &middot;{" "}
                    {new Date(sc.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                      sc.status === "open"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {sc.status}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">
                    {expandedId === sc.id ? "▾" : "▸"}
                  </span>
                </div>
              </button>

              {/* Expanded thread */}
              {expandedId === sc.id && (
                <div className="border-t border-zinc-100 bg-zinc-50">
                  <div className="max-h-64 divide-y divide-zinc-100 overflow-y-auto">
                    {messages.map((msg) => (
                      <div key={msg.id} className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold">
                            {msg.authorType === "customer"
                              ? sc.externalEmail ?? "External"
                              : msg.author}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            {new Date(msg.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
                          {msg.body}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Reply + actions */}
                  <div className="border-t border-zinc-200 p-4">
                    <div className="flex gap-2">
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder="Reply..."
                        rows={2}
                        className="flex-1 border-2 border-zinc-300 p-2 text-sm focus:border-zinc-950 focus:outline-none"
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={handleReply}
                          disabled={
                            replyState === "sending" || !replyBody.trim()
                          }
                          className="border-2 border-zinc-950 bg-zinc-950 px-3 py-1 font-mono text-[10px] font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {replyState === "sending" ? "..." : "Reply"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleStatusToggle(sc.id, sc.status)
                          }
                          className="border border-zinc-300 bg-white px-3 py-1 font-mono text-[10px] font-bold text-zinc-600 hover:bg-zinc-50"
                        >
                          {sc.status === "open" ? "Close" : "Reopen"}
                        </button>
                      </div>
                    </div>
                    {sc.externalEmail && (
                      <label className="mt-2 flex items-center gap-2 font-mono text-[10px] font-bold text-zinc-500">
                        <input
                          type="checkbox"
                          checked={replySendEmail}
                          onChange={(e) =>
                            setReplySendEmail(e.target.checked)
                          }
                          className="h-3 w-3"
                        />
                        Also send via email
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
