"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types mirroring server responses
// ---------------------------------------------------------------------------

interface AIAgentStats {
  totalRuns: number;
  resolved: number;
  escalated: number;
  avgConfidence: number;
  resolutionRate: number;
  escalationRate: number;
  recentResults: AIAgentResult[];
}

interface AIAgentResult {
  ticketId: string;
  resolved: boolean;
  confidence: number;
  suggestedReply: string;
  reasoning: string;
  escalated: boolean;
  escalationReason?: string;
  kbArticlesUsed: string[];
}

interface TopicSpike {
  topic: string;
  currentCount: number;
  baselineCount: number;
  percentIncrease: number;
  sampleTicketIds: string[];
}

interface SentimentTrend {
  period: string;
  averageSentiment: number;
  ticketsAnalyzed: number;
  direction: "improving" | "declining" | "stable";
}

interface Anomaly {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
  detectedAt: string;
  relatedTicketIds: string[];
}

interface KBGap {
  topic: string;
  ticketCount: number;
  sampleQuestions: string[];
  suggestedTitle: string;
  suggestedOutline: string;
}

interface Insights {
  generatedAt: string;
  topicSpikes: TopicSpike[];
  sentimentTrend: SentimentTrend;
  anomalies: Anomaly[];
  kbGaps: KBGap[];
  summary: string;
}

interface QAOverview {
  totalScored: number;
  avgTone: number;
  avgCompleteness: number;
  avgAccuracy: number;
  avgBrandVoice: number;
  avgOverall: number;
  flagCount: number;
  criticalFlags: number;
  recentReports: QAReport[];
}

interface QAReport {
  ticketId: string;
  scores: {
    tone: number;
    completeness: number;
    accuracy: number;
    brandVoice: number;
    overall: number;
  };
  flags: Array<{ category: string; severity: string; message: string }>;
  evaluatedAt: string;
}

interface RoutingAgent {
  agentId: string;
  agentName: string;
  skills: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AICommandCenterContent() {
  const [agentStats, setAgentStats] = useState<AIAgentStats | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsMode, setInsightsMode] = useState<string>("");
  const [qaOverview, setQAOverview] = useState<QAOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Agent run form
  const [ticketId, setTicketId] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentResult, setAgentResult] = useState<AIAgentResult | null>(null);

  // QA form
  const [qaTicketId, setQaTicketId] = useState("");
  const [qaText, setQaText] = useState("");
  const [qaRunning, setQaRunning] = useState(false);
  const [qaResult, setQaResult] = useState<QAReport | null>(null);

  // Routing form
  const [routeTicketId, setRouteTicketId] = useState("");
  const [routeRunning, setRouteRunning] = useState(false);
  const [routeResult, setRouteResult] = useState<{
    suggestedAgentName: string;
    matchedSkills: string[];
    reasoning: string;
    confidence: number;
    alternateAgents: Array<{ agentName: string; score: number }>;
  } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<
    "overview" | "agent" | "routing" | "insights" | "qa"
  >("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, insightsRes, qaRes] = await Promise.all([
        fetch("/api/ai/agent").then((r) => r.json()),
        fetch("/api/ai/insights?useLLM=false").then((r) => r.json()),
        fetch("/api/ai/qa").then((r) => r.json()),
      ]);

      setAgentStats(agentRes.stats ?? null);
      setInsights(insightsRes.insights ?? null);
      setInsightsMode(insightsRes.mode ?? "");
      setQAOverview(qaRes.overview ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function runAIAgent() {
    if (!ticketId.trim()) return;
    setAgentRunning(true);
    setAgentResult(null);
    try {
      const res = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticketId.trim(), dryRun: true }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setAgentResult(data.result);
        fetchData(); // refresh stats
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setAgentRunning(false);
    }
  }

  async function runQA() {
    if (!qaTicketId.trim() || !qaText.trim()) return;
    setQaRunning(true);
    setQaResult(null);
    try {
      const res = await fetch("/api/ai/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: qaTicketId.trim(),
          responseText: qaText.trim(),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setQaResult(data.report);
        fetchData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "QA scoring failed");
    } finally {
      setQaRunning(false);
    }
  }

  async function runRouting() {
    if (!routeTicketId.trim()) return;
    setRouteRunning(true);
    setRouteResult(null);
    try {
      const res = await fetch("/api/ai/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: routeTicketId.trim(),
          useLLM: false,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setRouteResult(data.routing);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Routing failed");
    } finally {
      setRouteRunning(false);
    }
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "agent" as const, label: "AI Agent" },
    { id: "routing" as const, label: "Routing" },
    { id: "insights" as const, label: "Insights" },
    { id: "qa" as const, label: "QA" },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Phase 3
            </p>
            <h1 className="mt-2 text-3xl font-bold">AI Command Center</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Autonomous resolution, smart routing, proactive insights, and
              quality scoring.
            </p>
          </div>
        </div>

        {/* TABS */}
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
                activeTab === tab.id
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* ERROR BANNER */}
      {error && (
        <div className="mt-4 border-2 border-red-500 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-sm text-red-700">{error}</p>
            <button
              onClick={() => setError(null)}
              className="font-mono text-xs font-bold text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">
            Loading AI systems...
          </p>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {!loading && activeTab === "overview" && (
        <div className="mt-8 space-y-8">
          {/* Stats Cards */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Agent Runs"
              value={agentStats?.totalRuns ?? 0}
            />
            <StatCard
              label="Resolution Rate"
              value={`${agentStats?.resolutionRate ?? 0}%`}
              accent="text-emerald-600"
            />
            <StatCard
              label="Avg Confidence"
              value={`${((agentStats?.avgConfidence ?? 0) * 100).toFixed(0)}%`}
              accent="text-blue-600"
            />
            <StatCard
              label="QA Avg Score"
              value={qaOverview?.avgOverall?.toFixed(1) ?? "---"}
              accent="text-amber-600"
            />
          </section>

          {/* Two Column: Recent Results + Anomalies */}
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Recent AI Agent Results */}
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Recent AI Resolutions</h2>
              {agentStats && agentStats.recentResults.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {agentStats.recentResults.slice(0, 5).map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                            r.resolved
                              ? "bg-emerald-400 text-black"
                              : r.escalated
                                ? "bg-amber-400 text-black"
                                : "bg-zinc-200 text-black"
                          }`}
                        >
                          {r.resolved
                            ? "resolved"
                            : r.escalated
                              ? "escalated"
                              : "pending"}
                        </span>
                        <span className="max-w-[200px] truncate font-mono text-xs text-zinc-600">
                          {r.ticketId.slice(0, 12)}
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold">
                        {(r.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">
                  No AI agent runs yet. Use the Agent tab to process a ticket.
                </p>
              )}
            </section>

            {/* Anomalies */}
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Anomalies</h2>
              {insights && insights.anomalies.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {insights.anomalies.slice(0, 5).map((a, i) => (
                    <div
                      key={i}
                      className="border-b border-zinc-100 pb-2 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                            a.severity === "high"
                              ? "bg-red-500 text-white"
                              : a.severity === "medium"
                                ? "bg-amber-400 text-black"
                                : "bg-zinc-200 text-black"
                          }`}
                        >
                          {a.severity}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">
                          {a.type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-700">
                        {a.description}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">
                  No anomalies detected. Operations normal.
                </p>
              )}
            </section>
          </div>

          {/* Insights Summary */}
          {insights && (
            <section className="border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  Intelligence Summary
                </h2>
                <span className="font-mono text-xs text-zinc-500">
                  {insightsMode}
                </span>
              </div>
              <pre className="mt-4 whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-300">
                {insights.summary}
              </pre>
            </section>
          )}

          {/* QA Overview */}
          {qaOverview && qaOverview.totalScored > 0 && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">QA Scores Overview</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-5">
                <ScoreBar label="Tone" value={qaOverview.avgTone} />
                <ScoreBar
                  label="Completeness"
                  value={qaOverview.avgCompleteness}
                />
                <ScoreBar label="Accuracy" value={qaOverview.avgAccuracy} />
                <ScoreBar
                  label="Brand Voice"
                  value={qaOverview.avgBrandVoice}
                />
                <ScoreBar
                  label="Overall"
                  value={qaOverview.avgOverall}
                  highlight
                />
              </div>
              <div className="mt-4 flex gap-6 font-mono text-xs text-zinc-500">
                <span>{qaOverview.totalScored} scored</span>
                <span>{qaOverview.flagCount} flags</span>
                {qaOverview.criticalFlags > 0 && (
                  <span className="text-red-500">
                    {qaOverview.criticalFlags} critical
                  </span>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* AGENT TAB */}
      {!loading && activeTab === "agent" && (
        <div className="mt-8 space-y-8">
          {/* Run Agent Form */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Run AI Agent</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Enter a ticket ID to have the AI agent attempt autonomous
              resolution (dry-run mode).
            </p>
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Ticket ID"
                className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                onKeyDown={(e) => e.key === "Enter" && runAIAgent()}
              />
              <button
                onClick={runAIAgent}
                disabled={agentRunning || !ticketId.trim()}
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {agentRunning ? "Running..." : "Run Agent"}
              </button>
            </div>
          </section>

          {/* Agent Result */}
          {agentResult && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Agent Result</h2>
                <div className="flex gap-2">
                  <span
                    className={`px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                      agentResult.resolved
                        ? "bg-emerald-400 text-black"
                        : agentResult.escalated
                          ? "bg-amber-400 text-black"
                          : "bg-zinc-200 text-black"
                    }`}
                  >
                    {agentResult.resolved
                      ? "resolved"
                      : agentResult.escalated
                        ? "escalated"
                        : "unresolved"}
                  </span>
                  <span className="px-2 py-0.5 font-mono text-xs font-bold bg-zinc-100">
                    {(agentResult.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
              </div>

              {agentResult.suggestedReply && (
                <div className="mt-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Suggested Reply
                  </p>
                  <div className="mt-2 border border-zinc-200 bg-zinc-50 p-4 text-sm whitespace-pre-wrap">
                    {agentResult.suggestedReply}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Reasoning
                </p>
                <p className="mt-1 text-sm text-zinc-700">
                  {agentResult.reasoning}
                </p>
              </div>

              {agentResult.escalationReason && (
                <div className="mt-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Escalation Reason
                  </p>
                  <p className="mt-1 text-sm text-amber-700">
                    {agentResult.escalationReason}
                  </p>
                </div>
              )}

              {agentResult.kbArticlesUsed.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    KB Articles Referenced
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {agentResult.kbArticlesUsed.map((id) => (
                      <span
                        key={id}
                        className="border border-zinc-300 bg-zinc-100 px-2 py-1 font-mono text-xs"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Agent Stats */}
          {agentStats && agentStats.totalRuns > 0 && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Agent Performance</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <div className="border border-zinc-200 p-4 text-center">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Total Runs
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {agentStats.totalRuns}
                  </p>
                </div>
                <div className="border border-zinc-200 p-4 text-center">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Resolved
                  </p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600">
                    {agentStats.resolved}
                  </p>
                </div>
                <div className="border border-zinc-200 p-4 text-center">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Escalated
                  </p>
                  <p className="mt-1 text-2xl font-bold text-amber-600">
                    {agentStats.escalated}
                  </p>
                </div>
                <div className="border border-zinc-200 p-4 text-center">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Avg Confidence
                  </p>
                  <p className="mt-1 text-2xl font-bold text-blue-600">
                    {(agentStats.avgConfidence * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              {/* Recent results table */}
              {agentStats.recentResults.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Ticket
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Status
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Confidence
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Reasoning
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentStats.recentResults.slice(0, 10).map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-zinc-100 hover:bg-zinc-50"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.ticketId.slice(0, 12)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                                r.resolved
                                  ? "bg-emerald-400 text-black"
                                  : r.escalated
                                    ? "bg-amber-400 text-black"
                                    : "bg-zinc-200 text-black"
                              }`}
                            >
                              {r.resolved
                                ? "resolved"
                                : r.escalated
                                  ? "escalated"
                                  : "pending"}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs font-bold">
                            {(r.confidence * 100).toFixed(0)}%
                          </td>
                          <td className="max-w-xs truncate px-3 py-2 text-xs text-zinc-600">
                            {r.reasoning}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ROUTING TAB */}
      {!loading && activeTab === "routing" && (
        <div className="mt-8 space-y-8">
          {/* Route Form */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Smart Ticket Routing</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Skills-based routing with round-robin and capacity awareness.
            </p>
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={routeTicketId}
                onChange={(e) => setRouteTicketId(e.target.value)}
                placeholder="Ticket ID"
                className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                onKeyDown={(e) => e.key === "Enter" && runRouting()}
              />
              <button
                onClick={runRouting}
                disabled={routeRunning || !routeTicketId.trim()}
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {routeRunning ? "Routing..." : "Route"}
              </button>
            </div>
          </section>

          {/* Route Result */}
          {routeResult && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Routing Suggestion</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="border border-zinc-200 p-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Suggested Agent
                  </p>
                  <p className="mt-1 text-xl font-bold">
                    {routeResult.suggestedAgentName}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {routeResult.matchedSkills.map((s) => (
                      <span
                        key={s}
                        className="bg-emerald-100 px-2 py-0.5 font-mono text-xs font-bold text-emerald-800"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border border-zinc-200 p-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Confidence
                  </p>
                  <p className="mt-1 text-xl font-bold">
                    {(routeResult.confidence * 100).toFixed(0)}%
                  </p>
                  <p className="mt-2 text-sm text-zinc-600">
                    {routeResult.reasoning}
                  </p>
                </div>
              </div>

              {routeResult.alternateAgents.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Alternate Agents
                  </p>
                  <div className="mt-2 space-y-2">
                    {routeResult.alternateAgents.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border border-zinc-100 px-3 py-2"
                      >
                        <span className="text-sm font-medium">
                          {a.agentName}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">
                          {(a.score * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Agent Skills Config */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Agent Skills Map</h2>
            <div className="mt-4 space-y-3">
              {(
                [
                  {
                    agentId: "agent-1",
                    agentName: "Alice Chen",
                    skills: ["technical", "api", "integration", "bug"],
                  },
                  {
                    agentId: "agent-2",
                    agentName: "Bob Martinez",
                    skills: ["billing", "account", "subscription", "refund"],
                  },
                  {
                    agentId: "agent-3",
                    agentName: "Carol Davis",
                    skills: [
                      "onboarding",
                      "setup",
                      "feature-request",
                      "general",
                    ],
                  },
                  {
                    agentId: "agent-4",
                    agentName: "Dan Kim",
                    skills: ["security", "compliance", "data", "privacy"],
                  },
                ] as RoutingAgent[]
              ).map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex flex-wrap items-center justify-between border border-zinc-200 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{agent.agentName}</span>
                    <span className="font-mono text-xs text-zinc-400">
                      {agent.agentId}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {agent.skills.map((s) => (
                      <span
                        key={s}
                        className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 font-mono text-xs text-zinc-500">
              <span>Round Robin: On</span>
              <span>Priority Weighting: On</span>
              <span>Timezone Aware: Off</span>
            </div>
          </section>
        </div>
      )}

      {/* INSIGHTS TAB */}
      {!loading && activeTab === "insights" && (
        <div className="mt-8 space-y-8">
          {/* Summary */}
          {insights && (
            <>
              <section className="border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">
                    Proactive Intelligence
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-zinc-500">
                      {insightsMode}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      {new Date(insights.generatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <pre className="mt-4 whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-300">
                  {insights.summary}
                </pre>
              </section>

              {/* Sentiment */}
              <section className="border-2 border-zinc-950 bg-white p-6">
                <h2 className="text-lg font-bold">Sentiment Trend</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div className="border border-zinc-200 p-4 text-center">
                    <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                      Average
                    </p>
                    <p
                      className={`mt-1 text-2xl font-bold ${
                        insights.sentimentTrend.averageSentiment > 0
                          ? "text-emerald-600"
                          : insights.sentimentTrend.averageSentiment < 0
                            ? "text-red-600"
                            : "text-zinc-600"
                      }`}
                    >
                      {insights.sentimentTrend.averageSentiment.toFixed(2)}
                    </p>
                  </div>
                  <div className="border border-zinc-200 p-4 text-center">
                    <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                      Direction
                    </p>
                    <p
                      className={`mt-1 text-2xl font-bold ${
                        insights.sentimentTrend.direction === "improving"
                          ? "text-emerald-600"
                          : insights.sentimentTrend.direction === "declining"
                            ? "text-red-600"
                            : "text-zinc-600"
                      }`}
                    >
                      {insights.sentimentTrend.direction}
                    </p>
                  </div>
                  <div className="border border-zinc-200 p-4 text-center">
                    <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                      Tickets Analyzed
                    </p>
                    <p className="mt-1 text-2xl font-bold">
                      {insights.sentimentTrend.ticketsAnalyzed}
                    </p>
                  </div>
                </div>
              </section>

              {/* Topic Spikes */}
              {insights.topicSpikes.length > 0 && (
                <section className="border-2 border-zinc-950 bg-white p-6">
                  <h2 className="text-lg font-bold">Topic Spikes</h2>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                          <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                            Topic
                          </th>
                          <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                            Current
                          </th>
                          <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                            Baseline
                          </th>
                          <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                            Increase
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {insights.topicSpikes.map((spike, i) => (
                          <tr
                            key={i}
                            className="border-b border-zinc-100 hover:bg-zinc-50"
                          >
                            <td className="px-3 py-2 font-medium">
                              {spike.topic}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs font-bold">
                              {spike.currentCount}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                              {spike.baselineCount}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`font-mono text-xs font-bold ${
                                  spike.percentIncrease >= 200
                                    ? "text-red-600"
                                    : spike.percentIncrease >= 100
                                      ? "text-amber-600"
                                      : "text-zinc-600"
                                }`}
                              >
                                +{spike.percentIncrease}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* KB Gaps */}
              {insights.kbGaps.length > 0 && (
                <section className="border-2 border-zinc-950 bg-white p-6">
                  <h2 className="text-lg font-bold">
                    KB Gaps (Suggested Articles)
                  </h2>
                  <div className="mt-4 space-y-4">
                    {insights.kbGaps.map((gap, i) => (
                      <div
                        key={i}
                        className="border border-zinc-200 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-bold">{gap.suggestedTitle}</p>
                          <span className="font-mono text-xs text-zinc-500">
                            {gap.ticketCount} tickets
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">
                          {gap.suggestedOutline}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {gap.sampleQuestions.slice(0, 3).map((q, j) => (
                            <span
                              key={j}
                              className="border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600"
                            >
                              {q.length > 60 ? q.slice(0, 60) + "..." : q}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Anomalies detailed */}
              {insights.anomalies.length > 0 && (
                <section className="border-2 border-zinc-950 bg-white p-6">
                  <h2 className="text-lg font-bold">Anomaly Details</h2>
                  <div className="mt-4 space-y-3">
                    {insights.anomalies.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 border-b border-zinc-100 pb-3 last:border-0"
                      >
                        <span
                          className={`mt-0.5 inline-block shrink-0 px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                            a.severity === "high"
                              ? "bg-red-500 text-white"
                              : a.severity === "medium"
                                ? "bg-amber-400 text-black"
                                : "bg-zinc-200 text-black"
                          }`}
                        >
                          {a.severity}
                        </span>
                        <div>
                          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                            {a.type.replace(/_/g, " ")}
                          </p>
                          <p className="mt-0.5 text-sm text-zinc-700">
                            {a.description}
                          </p>
                          {a.relatedTicketIds.length > 0 && (
                            <p className="mt-1 font-mono text-xs text-zinc-400">
                              Tickets:{" "}
                              {a.relatedTicketIds.slice(0, 3).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* No insights data */}
              {insights.topicSpikes.length === 0 &&
                insights.anomalies.length === 0 &&
                insights.kbGaps.length === 0 && (
                  <section className="border-2 border-zinc-950 bg-white p-8 text-center">
                    <p className="text-lg font-bold">No patterns detected</p>
                    <p className="mt-2 text-sm text-zinc-600">
                      Import more ticket data to enable pattern detection. The
                      system analyzes 30-day windows for trends.
                    </p>
                  </section>
                )}
            </>
          )}
        </div>
      )}

      {/* QA TAB */}
      {!loading && activeTab === "qa" && (
        <div className="mt-8 space-y-8">
          {/* Score Form */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Score a Response</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Evaluate an agent reply for tone, completeness, accuracy, and
              brand voice.
            </p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={qaTicketId}
                onChange={(e) => setQaTicketId(e.target.value)}
                placeholder="Ticket ID"
                className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
              <textarea
                value={qaText}
                onChange={(e) => setQaText(e.target.value)}
                placeholder="Paste the agent reply text to evaluate..."
                rows={5}
                className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
              <button
                onClick={runQA}
                disabled={
                  qaRunning || !qaTicketId.trim() || !qaText.trim()
                }
                className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {qaRunning ? "Scoring..." : "Score Response"}
              </button>
            </div>
          </section>

          {/* QA Result */}
          {qaResult && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">QA Report</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-5">
                <ScoreBar label="Tone" value={qaResult.scores.tone} />
                <ScoreBar
                  label="Completeness"
                  value={qaResult.scores.completeness}
                />
                <ScoreBar
                  label="Accuracy"
                  value={qaResult.scores.accuracy}
                />
                <ScoreBar
                  label="Brand Voice"
                  value={qaResult.scores.brandVoice}
                />
                <ScoreBar
                  label="Overall"
                  value={qaResult.scores.overall}
                  highlight
                />
              </div>

              {qaResult.flags.length > 0 && (
                <div className="mt-4">
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Flags
                  </p>
                  <div className="mt-2 space-y-2">
                    {qaResult.flags.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2"
                      >
                        <span
                          className={`mt-0.5 shrink-0 px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                            f.severity === "critical"
                              ? "bg-red-500 text-white"
                              : f.severity === "warning"
                                ? "bg-amber-400 text-black"
                                : "bg-zinc-200 text-black"
                          }`}
                        >
                          {f.severity}
                        </span>
                        <span className="text-sm text-zinc-700">
                          {f.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* QA Overview */}
          {qaOverview && qaOverview.totalScored > 0 && (
            <section className="border-2 border-zinc-950 bg-white p-6">
              <h2 className="text-lg font-bold">Historical QA Scores</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-5">
                <ScoreBar label="Avg Tone" value={qaOverview.avgTone} />
                <ScoreBar
                  label="Avg Complete"
                  value={qaOverview.avgCompleteness}
                />
                <ScoreBar
                  label="Avg Accuracy"
                  value={qaOverview.avgAccuracy}
                />
                <ScoreBar
                  label="Avg Brand"
                  value={qaOverview.avgBrandVoice}
                />
                <ScoreBar
                  label="Avg Overall"
                  value={qaOverview.avgOverall}
                  highlight
                />
              </div>
              <div className="mt-4 flex gap-6 font-mono text-xs text-zinc-500">
                <span>{qaOverview.totalScored} responses scored</span>
                <span>{qaOverview.flagCount} total flags</span>
                {qaOverview.criticalFlags > 0 && (
                  <span className="text-red-500">
                    {qaOverview.criticalFlags} critical
                  </span>
                )}
              </div>

              {/* Recent reports */}
              {qaOverview.recentReports.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Ticket
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Overall
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Tone
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Complete
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Accuracy
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Flags
                        </th>
                        <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Date
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {qaOverview.recentReports.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-zinc-100 hover:bg-zinc-50"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.ticketId.slice(0, 12)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs font-bold">
                            {r.scores.overall.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.scores.tone}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.scores.completeness}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.scores.accuracy}
                          </td>
                          <td className="px-3 py-2">
                            {r.flags.length > 0 ? (
                              <span className="font-mono text-xs text-amber-600">
                                {r.flags.length}
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-zinc-400">
                                0
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                            {new Date(r.evaluatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* No QA data */}
          {(!qaOverview || qaOverview.totalScored === 0) && !qaResult && (
            <section className="border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No QA data yet</p>
              <p className="mt-2 text-sm text-zinc-600">
                Score a response above to start building QA analytics.
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${accent ?? "text-zinc-950"}`}>
        {value}
      </p>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const color =
    value >= 4
      ? "bg-emerald-500"
      : value >= 3
        ? "bg-amber-400"
        : "bg-red-500";

  return (
    <div>
      <div className="flex items-center justify-between">
        <p
          className={`font-mono text-xs font-bold uppercase ${highlight ? "text-zinc-950" : "text-zinc-500"}`}
        >
          {label}
        </p>
        <p
          className={`font-mono text-sm font-bold ${highlight ? "text-zinc-950" : "text-zinc-700"}`}
        >
          {value.toFixed(1)}
        </p>
      </div>
      <div className="mt-1 h-2 w-full bg-zinc-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
