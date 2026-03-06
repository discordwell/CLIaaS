"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import TicketSplitBar from "./TicketSplitBar";

interface MessageRow {
  id: string;
  author: string;
  type: string;
  body: string;
  createdAt: string;
}

interface TicketDetailClientProps {
  ticketId: string;
  ticketSubject: string;
  messages: MessageRow[];
  mergedIntoTicketId?: string;
  splitFromTicketId?: string;
  mergeHistory: Array<{
    id: string;
    type: string;
    primaryTicketId?: string;
    mergedTicketId?: string;
    sourceTicketId?: string;
    newTicketId?: string;
    undone: boolean;
    createdAt: string;
  }>;
}

export default function TicketDetailClient({
  ticketId,
  ticketSubject,
  messages,
  mergedIntoTicketId,
  splitFromTicketId,
  mergeHistory,
}: TicketDetailClientProps) {
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const router = useRouter();

  const toggleMessage = useCallback((id: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSplitComplete = useCallback(() => {
    setSelectedMessages(new Set());
    router.refresh();
  }, [router]);

  // Count incoming merges (tickets merged INTO this one)
  const incomingMerges = mergeHistory.filter(
    (h) => h.type === "merge" && h.primaryTicketId === ticketId && !h.undone
  );

  return (
    <>
      {/* Lineage Banners */}
      {mergedIntoTicketId && (
        <div className="mb-4 border-2 border-amber-400 bg-amber-50 p-4">
          <p className="font-mono text-xs font-bold uppercase text-amber-700">
            This ticket was merged into{" "}
            <a
              href={`/tickets/${mergedIntoTicketId}`}
              className="underline hover:text-amber-900"
            >
              #{mergedIntoTicketId.slice(0, 12)}...
            </a>
          </p>
        </div>
      )}

      {splitFromTicketId && (
        <div className="mb-4 border-2 border-indigo-400 bg-indigo-50 p-4">
          <p className="font-mono text-xs font-bold uppercase text-indigo-700">
            Split from{" "}
            <a
              href={`/tickets/${splitFromTicketId}`}
              className="underline hover:text-indigo-900"
            >
              #{splitFromTicketId.slice(0, 12)}...
            </a>
          </p>
        </div>
      )}

      {incomingMerges.length > 0 && (
        <div className="mb-4 border-2 border-emerald-400 bg-emerald-50 p-4">
          <p className="font-mono text-xs font-bold uppercase text-emerald-700">
            {incomingMerges.length} ticket(s) merged into this ticket
          </p>
        </div>
      )}

      {/* Conversation with checkboxes */}
      <section className="border-2 border-zinc-950 bg-white">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 p-6">
          <h2 className="text-lg font-bold">
            Conversation ({messages.length} message
            {messages.length !== 1 ? "s" : ""})
          </h2>
          {selectedMessages.size > 0 && (
            <span className="font-mono text-xs font-bold text-indigo-600">
              {selectedMessages.size} selected for split
            </span>
          )}
        </div>

        {messages.length > 0 ? (
          <div className="divide-y divide-zinc-200">
            {messages.map((msg, idx) => (
              <div
                key={msg.id}
                className={`flex gap-4 p-6 ${
                  selectedMessages.has(msg.id)
                    ? "bg-indigo-50"
                    : msg.type === "note"
                      ? "bg-amber-50/60 border-l-4 border-amber-400"
                      : ""
                }`}
              >
                {msg.type !== "system" && (
                  <div className="flex-shrink-0 pt-1">
                    <input
                      type="checkbox"
                      checked={selectedMessages.has(msg.id)}
                      onChange={() => toggleMessage(msg.id)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center bg-zinc-950 font-mono text-xs font-bold text-white">
                        {msg.type === "system" ? "S" : msg.author.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold">
                          {msg.type === "system" ? "System" : msg.author}
                        </p>
                        <p className="font-mono text-xs text-zinc-500">
                          {new Date(msg.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-400">
                        #{idx + 1}
                      </span>
                      {msg.type === "note" && (
                        <span className="bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold text-amber-700">
                          Internal Note
                        </span>
                      )}
                      {msg.type === "system" && (
                        <span className="bg-zinc-200 px-2 py-0.5 font-mono text-xs font-bold text-zinc-600">
                          System
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                    {msg.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-zinc-500">
            No messages in this ticket thread.
          </div>
        )}
      </section>

      {/* Merge History */}
      {mergeHistory.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full border-b border-zinc-200 p-4 text-left font-mono text-xs font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-50"
          >
            Merge / Split History ({mergeHistory.length})
            <span className="ml-2">{showHistory ? "▾" : "▸"}</span>
          </button>
          {showHistory && (
            <div className="divide-y divide-zinc-100">
              {mergeHistory.map((entry) => (
                <div key={entry.id} className="px-6 py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      {entry.type === "merge" ? (
                        <>
                          <span className="font-bold text-emerald-700">MERGE</span>{" "}
                          {entry.mergedTicketId?.slice(0, 12)}... → {entry.primaryTicketId?.slice(0, 12)}...
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-indigo-700">SPLIT</span>{" "}
                          {entry.sourceTicketId?.slice(0, 12)}... → {entry.newTicketId?.slice(0, 12)}...
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {entry.undone && (
                        <span className="bg-red-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-600">
                          UNDONE
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-zinc-400">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {selectedMessages.size > 0 && (
        <TicketSplitBar
          ticketId={ticketId}
          ticketSubject={ticketSubject}
          selectedMessageIds={Array.from(selectedMessages)}
          onSplitComplete={handleSplitComplete}
        />
      )}
    </>
  );
}
