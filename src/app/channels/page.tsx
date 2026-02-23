"use client";

import { useEffect, useState, useCallback } from "react";

// ---- Types ----

interface SmsMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  sid?: string;
  timestamp: number;
}

interface SmsConversation {
  id: string;
  phoneNumber: string;
  channel: "sms" | "whatsapp";
  customerName: string;
  status: "active" | "closed";
  messages: SmsMessage[];
  ticketId?: string;
  createdAt: number;
  lastActivity: number;
}

interface ChannelConfig {
  demo: boolean;
  phoneNumber: string;
  whatsappNumber: string;
}

interface SocialMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  externalMessageId?: string;
  timestamp: number;
}

interface SocialConversation {
  id: string;
  platform: "facebook" | "instagram" | "twitter";
  externalUserId: string;
  userName: string;
  status: "active" | "closed";
  messages: SocialMessage[];
  ticketId?: string;
  createdAt: number;
  lastActivity: number;
}

// ---- Tab definitions ----

type Tab = "sms" | "whatsapp" | "voice" | "facebook" | "instagram" | "x";

const TABS: { key: Tab; label: string }[] = [
  { key: "sms", label: "SMS" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "voice", label: "Voice" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X (Twitter)" },
];

// ---- Helpers ----

function shortDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ======================== MAIN COMPONENT ========================

export default function ChannelsPage() {
  const [tab, setTab] = useState<Tab>("sms");

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Channels
            </p>
            <h1 className="mt-2 text-3xl font-bold">Messaging Channels</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                tab === t.key
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      <div className="mt-8">
        {tab === "sms" && <MessagingTab channel="sms" />}
        {tab === "whatsapp" && <MessagingTab channel="whatsapp" />}
        {tab === "voice" && <VoiceTab />}
        {tab === "facebook" && <SocialTab platform="facebook" />}
        {tab === "instagram" && <SocialTab platform="instagram" />}
        {tab === "x" && <SocialTab platform="twitter" />}
      </div>
    </main>
  );
}

// ======================== MESSAGING TAB (SMS / WhatsApp) ========================

function MessagingTab({ channel }: { channel: "sms" | "whatsapp" }) {
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [config, setConfig] = useState<ChannelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ to: "", body: "" });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/channels/sms");
      const data = await res.json();
      const all: SmsConversation[] = data.conversations ?? [];
      setConversations(all.filter((c) => c.channel === channel));
      setConfig(data.config ?? null);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/channels/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: sendForm.to,
          body: sendForm.body,
          channel,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSendResult(`Message sent (SID: ${data.sid})`);
        setSendForm({ to: "", body: "" });
        load();
      } else {
        setSendResult(`Error: ${data.error}`);
      }
    } catch {
      setSendResult("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleReply(conversationId: string, to: string, body: string) {
    try {
      await fetch("/api/channels/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, body, channel, conversationId }),
      });
      load();
    } catch {
      // Silently fail
    }
  }

  async function handleClose(id: string) {
    try {
      await fetch(`/api/channels/sms/${id}`, { method: "PATCH" });
      setSelectedId(null);
      load();
    } catch {
      // Silently fail
    }
  }

  const selected = conversations.find((c) => c.id === selectedId);

  if (loading) return <LoadingBlock label={`Loading ${channel.toUpperCase()} conversations...`} />;

  return (
    <>
      {/* Config Status */}
      <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
              {channel === "sms" ? "SMS" : "WhatsApp"} Configuration
            </h3>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                  config?.demo
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {config?.demo ? "Demo Mode" : "Live"}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {channel === "sms"
                  ? `Sender: ${config?.phoneNumber ?? "N/A"}`
                  : `Sender: ${config?.whatsappNumber ?? "N/A"}`}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowSend(!showSend)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showSend ? "Cancel" : "Send Message"}
          </button>
        </div>
      </section>

      {/* Send Message Form */}
      {showSend && (
        <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Send {channel === "sms" ? "SMS" : "WhatsApp"} Message
          </h3>
          <form onSubmit={handleSend} className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormInput
              label="To (Phone Number)"
              required
              value={sendForm.to}
              onChange={(v) => setSendForm({ ...sendForm, to: v })}
              placeholder={channel === "sms" ? "+14155551234" : "+447700900123"}
            />
            <div className="sm:col-span-2">
              <FormInput
                label="Message"
                required
                value={sendForm.body}
                onChange={(v) => setSendForm({ ...sendForm, body: v })}
                placeholder="Type your message..."
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={sending}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
          {sendResult && (
            <p
              className={`mt-3 px-3 py-2 font-mono text-xs ${
                sendResult.startsWith("Error")
                  ? "bg-red-50 text-red-700"
                  : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {sendResult}
            </p>
          )}
        </section>
      )}

      {/* Conversation Detail */}
      {selected && (
        <ConversationDetail
          conversation={selected}
          channel={channel}
          onClose={() => setSelectedId(null)}
          onCloseConversation={handleClose}
          onReply={handleReply}
        />
      )}

      {/* Conversation List */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {conversations.length} Conversation{conversations.length !== 1 ? "s" : ""}
        </h2>
      </div>

      {conversations.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Customer
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Phone
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Messages
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Last Activity
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                    Created
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${
                      selectedId === c.id ? "bg-zinc-100" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                          c.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-zinc-200 text-zinc-600"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{c.customerName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.phoneNumber}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.messages.length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {timeAgo(c.lastActivity)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {shortDate(c.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          setSelectedId(selectedId === c.id ? null : c.id)
                        }
                        className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                      >
                        {selectedId === c.id ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock
          message={`No ${channel === "sms" ? "SMS" : "WhatsApp"} conversations`}
          sub={
            config?.demo
              ? "Running in demo mode. Conversations will appear when messages are received."
              : "Configure your Twilio webhook to start receiving messages."
          }
        />
      )}
    </>
  );
}

// ======================== CONVERSATION DETAIL ========================

function ConversationDetail({
  conversation,
  channel,
  onClose,
  onCloseConversation,
  onReply,
}: {
  conversation: SmsConversation;
  channel: "sms" | "whatsapp";
  onClose: () => void;
  onCloseConversation: (id: string) => void;
  onReply: (conversationId: string, to: string, body: string) => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setReplying(true);
    onReply(conversation.id, conversation.phoneNumber, replyBody);
    setReplyBody("");
    setReplying(false);
  }

  return (
    <section className="mb-4 border-2 border-zinc-950 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
        <div>
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Conversation with {conversation.customerName}
          </h3>
          <p className="mt-1 font-mono text-xs text-zinc-400">
            {conversation.phoneNumber} via {channel.toUpperCase()}
          </p>
        </div>
        <div className="flex gap-2">
          {conversation.status === "active" && (
            <button
              onClick={() => onCloseConversation(conversation.id)}
              className="border-2 border-red-500 bg-white px-3 py-1 font-mono text-xs font-bold uppercase text-red-500 hover:bg-red-50"
            >
              Close
            </button>
          )}
          <button
            onClick={onClose}
            className="border-2 border-zinc-300 bg-white px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="max-h-80 overflow-y-auto p-6">
        <div className="space-y-3">
          {conversation.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.direction === "outbound" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] px-4 py-2 ${
                  msg.direction === "outbound"
                    ? "border-2 border-zinc-950 bg-zinc-950 text-white"
                    : "border-2 border-zinc-300 bg-zinc-50"
                }`}
              >
                <p className="text-sm">{msg.body}</p>
                <p
                  className={`mt-1 font-mono text-xs ${
                    msg.direction === "outbound"
                      ? "text-zinc-400"
                      : "text-zinc-500"
                  }`}
                >
                  {shortDate(msg.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reply form */}
      {conversation.status === "active" && (
        <div className="border-t-2 border-zinc-200 p-4">
          <form onSubmit={handleReply} className="flex gap-2">
            <input
              type="text"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type a reply..."
              className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
            <button
              type="submit"
              disabled={replying || !replyBody.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              Reply
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ======================== VOICE TAB ========================

interface VoiceCallData {
  id: string;
  callSid: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  status: string;
  duration?: number;
  recordingUrl?: string;
  transcription?: string;
  agentId?: string;
  ivrPath?: string[];
  createdAt: number;
  updatedAt: number;
}

interface VoiceAgentData {
  id: string;
  name: string;
  extension: string;
  phoneNumber: string;
  status: "available" | "busy" | "offline";
}

function VoiceTab() {
  const [calls, setCalls] = useState<VoiceCallData[]>([]);
  const [agents, setAgents] = useState<VoiceAgentData[]>([]);
  const [demo, setDemo] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/channels/voice");
      const data = await res.json();
      setCalls(data.calls ?? []);
      setAgents(data.agents ?? []);
      setDemo(data.demo ?? true);
      setStats(data.stats ?? {});
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = calls.find((c) => c.id === selectedId);

  function formatDuration(sec?: number): string {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function statusColor(status: string): string {
    switch (status) {
      case "in-progress":
      case "ringing":
        return "bg-emerald-100 text-emerald-700";
      case "completed":
        return "bg-zinc-200 text-zinc-600";
      case "voicemail":
        return "bg-blue-100 text-blue-700";
      case "failed":
      case "busy":
      case "no-answer":
        return "bg-red-100 text-red-700";
      default:
        return "bg-zinc-200 text-zinc-600";
    }
  }

  if (loading) return <LoadingBlock label="Loading voice calls..." />;

  return (
    <>
      {/* Config Status */}
      <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
              Voice / Phone Configuration
            </h3>
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                  demo
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {demo ? "Demo Mode" : "Live"}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {stats.active ?? 0} active call{(stats.active ?? 0) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total Calls", value: stats.total ?? 0 },
            { label: "Completed", value: stats.completed ?? 0 },
            { label: "Voicemails", value: stats.voicemails ?? 0 },
            { label: "Active Now", value: stats.active ?? 0 },
          ].map((s) => (
            <div key={s.label} className="border border-zinc-200 p-3">
              <p className="font-mono text-xs text-zinc-500">{s.label}</p>
              <p className="mt-1 text-xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agents */}
      <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
          Agents
        </h3>
        <div className="mt-3 flex flex-wrap gap-3">
          {agents.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 border border-zinc-200 px-3 py-2"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  a.status === "available"
                    ? "bg-emerald-500"
                    : a.status === "busy"
                    ? "bg-amber-500"
                    : "bg-zinc-400"
                }`}
              />
              <span className="text-sm font-medium">{a.name}</span>
              <span className="font-mono text-xs text-zinc-500">
                ext. {a.extension}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Call Detail */}
      {selected && (
        <section className="mb-4 border-2 border-zinc-950 bg-white">
          <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
            <div>
              <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Call Details
              </h3>
              <p className="mt-1 text-sm font-medium">
                {selected.from} → {selected.to}
              </p>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="border-2 border-zinc-300 bg-white px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2 p-6">
            <DetailRow label="SID" value={selected.callSid} />
            <DetailRow label="Direction" value={selected.direction} />
            <DetailRow label="Status" value={selected.status} />
            <DetailRow label="Duration" value={formatDuration(selected.duration)} />
            <DetailRow label="IVR Path" value={selected.ivrPath?.join(" → ") ?? "—"} />
            {selected.recordingUrl && (
              <DetailRow label="Recording" value={selected.recordingUrl} />
            )}
            {selected.transcription && (
              <div>
                <p className="font-mono text-xs text-zinc-500">Transcription</p>
                <p className="mt-1 text-sm">{selected.transcription}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Call List */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {calls.length} Call{calls.length !== 1 ? "s" : ""}
        </h2>
      </div>

      {calls.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Direction</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">From</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Duration</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Time</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${
                      selectedId === c.id ? "bg-zinc-100" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColor(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.direction}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.from}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatDuration(c.duration)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{timeAgo(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                        className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                      >
                        {selectedId === c.id ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock
          message="No voice calls"
          sub={
            demo
              ? "Running in demo mode. Calls will appear when your Twilio voice webhook is configured."
              : "Configure your Twilio voice webhook to start receiving calls."
          }
        />
      )}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="w-24 shrink-0 font-mono text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

// ======================== SOCIAL TAB ========================

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook Messenger",
  instagram: "Instagram DMs",
  twitter: "X (Twitter) DMs",
};

const PLATFORM_SEND_URLS: Record<string, string> = {
  facebook: "/api/channels/facebook/send",
  instagram: "/api/channels/instagram/send",
  twitter: "/api/channels/twitter/send",
};

function SocialTab({ platform }: { platform: "facebook" | "instagram" | "twitter" }) {
  const [conversations, setConversations] = useState<SocialConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ recipientId: "", text: "" });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/channels/social");
      const data = await res.json();
      const all: SocialConversation[] = data.conversations ?? [];
      setConversations(all.filter((c) => c.platform === platform));
      setDemo(data.platforms?.[platform]?.demo ?? true);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(PLATFORM_SEND_URLS[platform], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendForm),
      });
      const data = await res.json();
      if (data.success) {
        setSendResult(`Message sent (ID: ${data.messageId})`);
        setSendForm({ recipientId: "", text: "" });
        load();
      } else {
        setSendResult(`Error: ${data.error}`);
      }
    } catch {
      setSendResult("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleReply(conversationId: string, recipientId: string, text: string) {
    try {
      await fetch(PLATFORM_SEND_URLS[platform], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, text, conversationId }),
      });
      load();
    } catch {
      // Silently fail
    }
  }

  const selected = conversations.find((c) => c.id === selectedId);

  if (loading) return <LoadingBlock label={`Loading ${PLATFORM_LABELS[platform]}...`} />;

  return (
    <>
      {/* Config Status */}
      <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
              {PLATFORM_LABELS[platform]} Configuration
            </h3>
            <div className="mt-2">
              <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                demo ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
              }`}>
                {demo ? "Demo Mode" : "Live"}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowSend(!showSend)}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            {showSend ? "Cancel" : "Send Message"}
          </button>
        </div>
      </section>

      {/* Send Message Form */}
      {showSend && (
        <section className="mb-4 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Send {PLATFORM_LABELS[platform]}
          </h3>
          <form onSubmit={handleSend} className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormInput
              label="Recipient ID"
              required
              value={sendForm.recipientId}
              onChange={(v) => setSendForm({ ...sendForm, recipientId: v })}
              placeholder="User or page-scoped ID"
            />
            <div className="sm:col-span-2">
              <FormInput
                label="Message"
                required
                value={sendForm.text}
                onChange={(v) => setSendForm({ ...sendForm, text: v })}
                placeholder="Type your message..."
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={sending}
                className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
          {sendResult && (
            <p className={`mt-3 px-3 py-2 font-mono text-xs ${
              sendResult.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-700"
            }`}>
              {sendResult}
            </p>
          )}
        </section>
      )}

      {/* Conversation Detail */}
      {selected && (
        <SocialConversationDetail
          conversation={selected}
          onClose={() => setSelectedId(null)}
          onReply={handleReply}
        />
      )}

      {/* Conversation List */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {conversations.length} Conversation{conversations.length !== 1 ? "s" : ""}
        </h2>
      </div>

      {conversations.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">User</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">External ID</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Messages</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Last Activity</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500" />
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id} className={`border-b border-zinc-100 transition-colors hover:bg-zinc-50 ${selectedId === c.id ? "bg-zinc-100" : ""}`}>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                        c.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{c.userName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{c.externalUserId}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.messages.length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{timeAgo(c.lastActivity)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                        className="font-mono text-xs font-bold uppercase text-blue-600 hover:text-blue-800"
                      >
                        {selectedId === c.id ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <EmptyBlock
          message={`No ${PLATFORM_LABELS[platform]} conversations`}
          sub={demo
            ? "Running in demo mode. Conversations will appear when messages are received."
            : "Configure your webhook to start receiving messages."}
        />
      )}
    </>
  );
}

// ======================== SOCIAL CONVERSATION DETAIL ========================

function SocialConversationDetail({
  conversation,
  onClose,
  onReply,
}: {
  conversation: SocialConversation;
  onClose: () => void;
  onReply: (conversationId: string, recipientId: string, text: string) => void;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setReplying(true);
    onReply(conversation.id, conversation.externalUserId, replyBody);
    setReplyBody("");
    setReplying(false);
  }

  return (
    <section className="mb-4 border-2 border-zinc-950 bg-white">
      <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
        <div>
          <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Conversation with {conversation.userName}
          </h3>
          <p className="mt-1 font-mono text-xs text-zinc-400">
            {conversation.externalUserId} via {conversation.platform}
          </p>
        </div>
        <button onClick={onClose} className="border-2 border-zinc-300 bg-white px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100">
          Dismiss
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-6">
        <div className="space-y-3">
          {conversation.messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] px-4 py-2 ${
                msg.direction === "outbound"
                  ? "border-2 border-zinc-950 bg-zinc-950 text-white"
                  : "border-2 border-zinc-300 bg-zinc-50"
              }`}>
                <p className="text-sm">{msg.body}</p>
                <p className={`mt-1 font-mono text-xs ${msg.direction === "outbound" ? "text-zinc-400" : "text-zinc-500"}`}>
                  {shortDate(msg.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {conversation.status === "active" && (
        <div className="border-t-2 border-zinc-200 p-4">
          <form onSubmit={handleReply} className="flex gap-2">
            <input
              type="text"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type a reply..."
              className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
            <button
              type="submit"
              disabled={replying || !replyBody.trim()}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              Reply
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

// ======================== SHARED SUB-COMPONENTS ========================

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs font-bold uppercase">{label}</span>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
        placeholder={placeholder}
      />
    </label>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="border-2 border-zinc-950 bg-white p-8 text-center">
      <p className="font-mono text-sm text-zinc-500">{label}</p>
    </section>
  );
}

function EmptyBlock({ message, sub }: { message: string; sub: string }) {
  return (
    <section className="border-2 border-zinc-950 bg-white p-8 text-center">
      <p className="text-lg font-bold">{message}</p>
      <p className="mt-2 text-sm text-zinc-600">{sub}</p>
    </section>
  );
}
