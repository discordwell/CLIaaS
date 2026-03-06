"use client";

import { useState } from "react";
import type { RuleFormData } from "./RuleForm";

interface Props {
  ruleData: RuleFormData;
  ruleId?: string;
  onClose: () => void;
}

interface DryRunResult {
  matched: boolean;
  actionsExecuted: number;
  changes: Record<string, unknown>;
  notifications: Array<{ type: string; to: string }>;
  webhooks: Array<{ url: string; method: string }>;
  errors: string[];
  durationMs: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const inputClass =
  "w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950";

export default function DryRunPanel({ ruleData, ruleId, onClose }: Props) {
  const [ticket, setTicket] = useState({
    id: "test-ticket-1",
    subject: "Test ticket subject",
    status: "open",
    priority: "normal",
    requester: "user@example.com",
    assignee: "",
    tags: "bug",
    event: "create" as string,
  });
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        ticket: {
          ...ticket,
          tags: ticket.tags.split(",").map((t) => t.trim()).filter(Boolean),
          assignee: ticket.assignee || null,
        },
      };

      if (ruleId) {
        body.ruleId = ruleId;
      } else {
        body.rule = {
          name: ruleData.name,
          type: ruleData.type,
          conditions: ruleData.conditions,
          actions: ruleData.actions,
        };
      }

      const res = await fetch("/api/rules/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Dry-run failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Request failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mt-4 border-2 border-blue-300 bg-blue-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold uppercase text-blue-700">
          Dry Run — Test Rule
        </h3>
        <button
          onClick={onClose}
          className="font-mono text-xs font-bold text-blue-500 hover:text-blue-700"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Status</span>
          <select
            value={ticket.status}
            onChange={(e) => setTicket({ ...ticket, status: e.target.value })}
            className={inputClass}
          >
            {["open", "pending", "on_hold", "solved", "closed"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Priority</span>
          <select
            value={ticket.priority}
            onChange={(e) => setTicket({ ...ticket, priority: e.target.value })}
            className={inputClass}
          >
            {["low", "normal", "high", "urgent"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Event</span>
          <select
            value={ticket.event}
            onChange={(e) => setTicket({ ...ticket, event: e.target.value })}
            className={inputClass}
          >
            {["create", "update", "reply", "status_change", "assignment"].map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Subject</span>
          <input
            type="text"
            value={ticket.subject}
            onChange={(e) => setTicket({ ...ticket, subject: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Requester</span>
          <input
            type="text"
            value={ticket.requester}
            onChange={(e) => setTicket({ ...ticket, requester: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase text-zinc-600">Tags (comma-separated)</span>
          <input
            type="text"
            value={ticket.tags}
            onChange={(e) => setTicket({ ...ticket, tags: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <button
        onClick={runTest}
        disabled={testing}
        className="mt-4 border-2 border-blue-600 bg-blue-600 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {testing ? "Testing..." : "Run Test"}
      </button>

      {error && (
        <div className="mt-3 border border-red-300 bg-red-50 p-3 font-mono text-xs text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className={`border-2 p-3 font-mono text-sm font-bold ${result.matched ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-zinc-300 bg-zinc-50 text-zinc-600"}`}>
            {result.matched ? `MATCHED — ${result.actionsExecuted} action(s) would fire` : "NOT MATCHED — no actions would fire"}
            <span className="ml-2 text-xs font-normal text-zinc-500">({result.durationMs}ms)</span>
          </div>

          {result.matched && Object.keys(result.changes).length > 0 && (
            <div className="border border-zinc-200 bg-white p-3">
              <h4 className="font-mono text-xs font-bold uppercase text-zinc-500">Changes</h4>
              <pre className="mt-2 overflow-auto font-mono text-xs text-zinc-700">
                {JSON.stringify(result.changes, null, 2)}
              </pre>
            </div>
          )}

          {result.notifications.length > 0 && (
            <div className="border border-zinc-200 bg-white p-3">
              <h4 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Notifications ({result.notifications.length})
              </h4>
              {result.notifications.map((n, i) => (
                <p key={i} className="mt-1 font-mono text-xs text-zinc-600">
                  {n.type} → {n.to}
                </p>
              ))}
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="border border-red-200 bg-red-50 p-3">
              <h4 className="font-mono text-xs font-bold uppercase text-red-600">Errors</h4>
              {result.errors.map((e, i) => (
                <p key={i} className="mt-1 font-mono text-xs text-red-600">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
