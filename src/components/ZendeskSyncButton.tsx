"use client";

import { useState } from "react";

export default function ZendeskSyncButton() {
  const [state, setState] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const onClick = async () => {
    setState("syncing");
    setMessage("");
    try {
      const res = await fetch("/api/zendesk/sync/outbound", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Sync failed");
      }
      const updated = typeof data.updated === "number" ? data.updated : 0;
      const skipped = typeof data.skipped === "number" ? data.skipped : 0;
      setMessage(`Pushed ${updated} ticket${updated === 1 ? "" : "s"} (${skipped} skipped)`);
      setState("success");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed");
      setState("error");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "syncing"}
        className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "syncing" ? "Syncing..." : "Sync to Zendesk"}
      </button>
      {message && (
        <span
          className={`text-xs font-mono ${
            state === "error" ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
