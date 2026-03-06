"use client";

import { useState, useRef, useEffect } from "react";
import { evaluateBotResponse, initBotSession } from "@/lib/chatbot/runtime";
import type { ChatbotFlow, ChatbotSessionState, ButtonOption } from "@/lib/chatbot/types";

interface TestChatPanelProps {
  flow: ChatbotFlow;
  onClose: () => void;
}

interface TestMessage {
  role: "bot" | "customer";
  body: string;
  buttons?: ButtonOption[];
}

export function TestChatPanel({ flow, onClose }: TestChatPanelProps) {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [state, setState] = useState<ChatbotSessionState | null>(null);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function startChat() {
    setMessages([]);
    setEnded(false);
    const session = initBotSession(flow);
    const resp = evaluateBotResponse(flow, session, "");

    const newMsgs: TestMessage[] = [];
    if (resp.text) {
      newMsgs.push({ role: "bot", body: resp.text, buttons: resp.buttons });
    }

    setMessages(newMsgs);
    if (resp.handoff || !resp.newState.currentNodeId) {
      setEnded(true);
      setState(null);
    } else {
      setState(resp.newState);
    }
  }

  function sendMessage(text: string) {
    if (!state || ended) return;

    setMessages((prev) => [...prev, { role: "customer", body: text }]);

    const resp = evaluateBotResponse(flow, state, text);

    if (resp.text) {
      setMessages((prev) => [...prev, { role: "bot", body: resp.text!, buttons: resp.buttons }]);
    }

    if (resp.delay) {
      setMessages((prev) => [...prev, { role: "bot", body: `[Waiting ${resp.delay}s...]` }]);
    }

    if (resp.aiRequest) {
      setMessages((prev) => [...prev, { role: "bot", body: "[AI would respond here]" }]);
    }

    if (resp.articleRequest) {
      setMessages((prev) => [...prev, { role: "bot", body: `[Article search: "${resp.articleRequest!.query}"]` }]);
    }

    if (resp.webhookRequest) {
      setMessages((prev) => [...prev, { role: "bot", body: `[Webhook: ${resp.webhookRequest!.method} ${resp.webhookRequest!.url}]` }]);
    }

    for (const action of resp.actions) {
      setMessages((prev) => [...prev, { role: "bot", body: `[Action: ${action.actionType}${action.value ? ` = ${action.value}` : ""}]` }]);
    }

    if (resp.handoff) {
      setMessages((prev) => [...prev, { role: "bot", body: "[Handoff to agent]" }]);
      setEnded(true);
      setState(null);
    } else if (!resp.newState.currentNodeId) {
      setEnded(true);
      setState(null);
    } else {
      setState(resp.newState);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  }

  // Auto-start on mount
  useEffect(() => {
    startChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex w-72 shrink-0 flex-col border-l-2 border-zinc-950 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-white">
        <span className="font-mono text-xs font-bold uppercase">Test Chat</span>
        <div className="flex items-center gap-2">
          <button onClick={startChat} className="font-mono text-[10px] text-zinc-400 hover:text-white">
            Restart
          </button>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            &times;
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-2 flex flex-col ${msg.role === "customer" ? "items-end" : "items-start"}`}
          >
            <div className="mb-0.5 font-mono text-[9px] font-bold uppercase text-zinc-400">
              {msg.role === "customer" ? "You" : "Bot"}
            </div>
            <div
              className={`max-w-[90%] border-2 px-2.5 py-1.5 text-[11px] ${
                msg.role === "customer"
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-indigo-300 bg-indigo-50"
              }`}
            >
              {msg.body}
            </div>
            {msg.buttons && (
              <div className="mt-1 flex flex-wrap gap-1">
                {msg.buttons.map((btn) => (
                  <button
                    key={btn.label}
                    onClick={() => sendMessage(btn.label)}
                    disabled={ended}
                    className="border-2 border-indigo-400 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {ended && (
          <div className="mt-2 border-2 border-zinc-200 bg-zinc-50 p-2 text-center">
            <p className="font-mono text-[10px] font-bold uppercase text-zinc-400">Chat Ended</p>
            <button onClick={startChat} className="mt-1 font-mono text-[10px] font-bold text-indigo-600 hover:text-indigo-800">
              Restart
            </button>
          </div>
        )}

        {state && (
          <div className="mt-1 text-[9px] text-zinc-400">
            Node: {state.currentNodeId.slice(0, 8)} · Vars: {Object.keys(state.variables).length}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {!ended && (
        <form onSubmit={handleSubmit} className="flex border-t-2 border-zinc-950">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type..."
            className="flex-1 px-3 py-2 text-xs outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="bg-zinc-950 px-3 py-2 font-mono text-[10px] font-bold uppercase text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
