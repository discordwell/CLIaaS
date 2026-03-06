"use client";

import { useState } from "react";

export default function ReRouteButton({ ticketId }: { ticketId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleReRoute() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/routing/route-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      if (data.assignedTo) {
        setResult(`Routed to ${data.assignedTo}`);
      } else {
        setResult(data.reason ?? "No eligible agent found");
      }
    } catch {
      setResult("Routing failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleReRoute}
        disabled={loading}
        className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {loading ? "Routing..." : "Re-Route Ticket"}
      </button>
      {result && (
        <p className="mt-2 font-mono text-xs text-zinc-600">{result}</p>
      )}
    </div>
  );
}
