"use client";

import { useState } from "react";
import type { ConnectorMeta } from "@/lib/connector-service";

export default function ConnectorCard({ connector }: { connector: ConnectorMeta }) {
  const [verifyState, setVerifyState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [exportState, setExportState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [exportMsg, setExportMsg] = useState("");

  const onVerify = async () => {
    setVerifyState("loading");
    setVerifyMsg("");
    try {
      const res = await fetch(`/api/connectors/${connector.id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      const details = [];
      if (data.userName) details.push(data.userName);
      if (data.agentCount) details.push(`${data.agentCount} agents`);
      if (data.ticketCount) details.push(`${data.ticketCount} tickets`);
      if (data.chatCount) details.push(`${data.chatCount} chats`);
      setVerifyMsg(details.length > 0 ? details.join(" · ") : "Connected");
      setVerifyState("success");
    } catch (err) {
      setVerifyMsg(err instanceof Error ? err.message : "Failed");
      setVerifyState("error");
    }
  };

  const onExport = async () => {
    setExportState("loading");
    setExportMsg("");
    try {
      const res = await fetch(`/api/connectors/${connector.id}/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Export failed");
      const counts = data.manifest?.counts;
      if (counts) {
        const parts = [];
        if (counts.tickets) parts.push(`${counts.tickets} tickets`);
        if (counts.messages) parts.push(`${counts.messages} messages`);
        if (counts.customers) parts.push(`${counts.customers} customers`);
        if (counts.kbArticles) parts.push(`${counts.kbArticles} KB articles`);
        setExportMsg(parts.join(", ") || "Export complete");
      } else {
        setExportMsg("Export complete");
      }
      setExportState("success");
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : "Failed");
      setExportState("error");
    }
  };

  const envKeys = Object.keys(connector.envVars);
  const allSet = envKeys.every(k => !!connector.envVars[k]);

  return (
    <div className="border-2 border-zinc-200 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-lg font-bold">{connector.name}</p>
          <span className="bg-zinc-950 px-2 py-0.5 font-mono text-xs font-bold uppercase text-white">
            bidirectional
          </span>
        </div>
        <span
          className={`border-2 border-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase ${
            connector.configured
              ? "bg-emerald-400 text-black"
              : "bg-amber-300 text-black"
          }`}
        >
          {connector.configured ? "configured" : "missing credentials"}
        </span>
      </div>

      {/* ENV VAR STATUS */}
      <div className="mt-4">
        <p className="font-mono text-xs font-bold uppercase text-zinc-500">
          Environment Variables
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {envKeys.map(key => (
            <span
              key={key}
              className={`flex items-center gap-1.5 px-2 py-1 font-mono text-xs font-bold ${
                connector.envVars[key]
                  ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border border-red-300 bg-red-50 text-red-800"
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                connector.envVars[key] ? "bg-emerald-500" : "bg-red-500"
              }`} />
              {key}
            </span>
          ))}
        </div>
      </div>

      {/* EXPORT STATS */}
      {connector.hasExport && (
        <div className="mt-4 border-t border-zinc-200 pt-4">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
            Last Export
          </p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <span className="font-mono">
              <span className="text-zinc-500">Tickets:</span>{" "}
              <span className="font-bold">{connector.ticketCount}</span>
            </span>
            <span className="font-mono">
              <span className="text-zinc-500">Messages:</span>{" "}
              <span className="font-bold">{connector.messageCount}</span>
            </span>
            <span className="font-mono">
              <span className="text-zinc-500">Customers:</span>{" "}
              <span className="font-bold">{connector.customerCount}</span>
            </span>
            <span className="font-mono">
              <span className="text-zinc-500">KB:</span>{" "}
              <span className="font-bold">{connector.kbArticleCount}</span>
            </span>
            {connector.lastExport && (
              <span className="font-mono text-zinc-500">
                {new Date(connector.lastExport).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ACTION BUTTONS */}
      {allSet && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4">
          <button
            type="button"
            onClick={onVerify}
            disabled={verifyState === "loading"}
            className="border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-950 hover:bg-zinc-100 disabled:opacity-60"
          >
            {verifyState === "loading" ? "Verifying..." : "Verify Connection"}
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exportState === "loading"}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {exportState === "loading" ? "Exporting..." : "Pull Data"}
          </button>
          {verifyMsg && (
            <span className={`font-mono text-xs ${
              verifyState === "error" ? "text-red-600" : "text-emerald-600"
            }`}>
              {verifyMsg}
            </span>
          )}
          {exportMsg && (
            <span className={`font-mono text-xs ${
              exportState === "error" ? "text-red-600" : "text-emerald-600"
            }`}>
              {exportMsg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
