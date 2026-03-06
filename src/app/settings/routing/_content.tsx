"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AgentAvailabilityIndicator from "@/components/routing/AgentAvailabilityIndicator";
import AgentSkillBadges from "@/components/routing/AgentSkillBadges";
import RoutingQueueCard from "@/components/routing/RoutingQueueCard";

interface RoutingConfig {
  defaultStrategy: string;
  enabled: boolean;
  autoRouteOnCreate: boolean;
  llmEnhanced: boolean;
}

interface Queue {
  id: string;
  name: string;
  strategy: string;
  priority: number;
  enabled: boolean;
  groupId?: string;
  conditions: Record<string, unknown>;
}

interface Rule {
  id: string;
  name: string;
  priority: number;
  targetType: string;
  targetId: string;
  enabled: boolean;
}

interface AgentAvail {
  userId: string;
  userName: string;
  status: "online" | "away" | "offline";
}

interface AgentSkill {
  userId: string;
  skillName: string;
  proficiency: number;
}

const STRATEGIES = ["round_robin", "load_balanced", "skill_match", "priority_weighted"];
const STRATEGY_LABELS: Record<string, string> = {
  round_robin: "Round Robin",
  load_balanced: "Load Balanced",
  skill_match: "Skill Match",
  priority_weighted: "Priority Weighted",
};

export default function RoutingSettingsContent() {
  const [config, setConfig] = useState<RoutingConfig | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [agents, setAgents] = useState<AgentAvail[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);

  // Queue creation form
  const [newQueueName, setNewQueueName] = useState("");
  const [newQueueStrategy, setNewQueueStrategy] = useState("skill_match");

  // Rule creation form
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleTargetType, setNewRuleTargetType] = useState("queue");
  const [newRuleTargetId, setNewRuleTargetId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, queuesRes, rulesRes, agentsRes, skillsRes] = await Promise.all([
        fetch("/api/routing/config"),
        fetch("/api/routing/queues"),
        fetch("/api/routing/rules"),
        fetch("/api/agents/availability"),
        fetch("/api/agents/skills"),
      ]);
      setConfig(await configRes.json());
      setQueues(await queuesRes.json());
      setRules(await rulesRes.json());
      setAgents(await agentsRes.json());
      setSkills(await skillsRes.json());
    } catch {
      // Fail gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function updateConfig(updates: Partial<RoutingConfig>) {
    if (!config) return;
    const updated = { ...config, ...updates };
    await fetch("/api/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setConfig(updated);
  }

  async function createQueue() {
    if (!newQueueName.trim()) return;
    const res = await fetch("/api/routing/queues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newQueueName,
        strategy: newQueueStrategy,
        priority: 0,
        conditions: {},
        enabled: true,
      }),
    });
    const queue = await res.json();
    setQueues([...queues, queue]);
    setNewQueueName("");
  }

  async function deleteQueue(id: string) {
    await fetch(`/api/routing/queues/${id}`, { method: "DELETE" });
    setQueues(queues.filter(q => q.id !== id));
  }

  async function createRule() {
    if (!newRuleName.trim() || !newRuleTargetId.trim()) return;
    const res = await fetch("/api/routing/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newRuleName,
        priority: 0,
        conditions: {},
        targetType: newRuleTargetType,
        targetId: newRuleTargetId,
        enabled: true,
      }),
    });
    const rule = await res.json();
    setRules([...rules, rule]);
    setNewRuleName("");
    setNewRuleTargetId("");
  }

  async function deleteRule(id: string) {
    await fetch(`/api/routing/rules/${id}`, { method: "DELETE" });
    setRules(rules.filter(r => r.id !== id));
  }

  function getAgentSkills(userId: string): string[] {
    return skills.filter(s => s.userId === userId).map(s => s.skillName);
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading routing settings...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/settings" className="hover:underline">Settings</Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Routing</span>
        </nav>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Routing Engine
        </p>
        <h1 className="mt-4 text-4xl font-bold">Omnichannel Routing</h1>
        <p className="mt-4 text-lg font-medium text-zinc-600">
          Skill-based, capacity-aware routing with round-robin, load balancing, and priority weighting.
        </p>
      </header>

      {/* CONFIG */}
      {config && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
          <h2 className="text-2xl font-bold">Configuration</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => updateConfig({ enabled: e.target.checked })}
                className="h-4 w-4 accent-zinc-950"
              />
              <span className="font-mono text-sm font-bold">Routing Enabled</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={config.autoRouteOnCreate}
                onChange={(e) => updateConfig({ autoRouteOnCreate: e.target.checked })}
                className="h-4 w-4 accent-zinc-950"
              />
              <span className="font-mono text-sm font-bold">Auto-Route on Ticket Creation</span>
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">Default Strategy</span>
              <select
                value={config.defaultStrategy}
                onChange={(e) => updateConfig({ defaultStrategy: e.target.value })}
                className="mt-1 block w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {/* QUEUES */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Routing Queues</h2>
        <div className="mt-6 space-y-4">
          {queues.map((q) => (
            <div key={q.id} className="flex items-center justify-between">
              <RoutingQueueCard name={q.name} strategy={q.strategy} enabled={q.enabled} totalRouted={0} />
              <button
                onClick={() => deleteQueue(q.id)}
                className="ml-4 border-2 border-red-300 px-3 py-1 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          ))}
          {queues.length === 0 && (
            <p className="font-mono text-sm text-zinc-500">No queues configured.</p>
          )}
        </div>
        <div className="mt-6 flex gap-3">
          <input
            type="text"
            placeholder="Queue name"
            value={newQueueName}
            onChange={(e) => setNewQueueName(e.target.value)}
            className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <select
            value={newQueueStrategy}
            onChange={(e) => setNewQueueStrategy(e.target.value)}
            className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
            ))}
          </select>
          <button
            onClick={createQueue}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Add Queue
          </button>
        </div>
      </section>

      {/* RULES */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Routing Rules</h2>
        <div className="mt-6 space-y-3">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between border border-zinc-200 p-3">
              <div>
                <span className="font-bold">{r.name}</span>
                <span className="ml-3 font-mono text-xs text-zinc-500">
                  {r.targetType}:{r.targetId.slice(0, 8)}
                </span>
              </div>
              <button
                onClick={() => deleteRule(r.id)}
                className="border border-red-300 px-2 py-1 font-mono text-xs font-bold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="font-mono text-sm text-zinc-500">No routing rules configured.</p>
          )}
        </div>
        <div className="mt-6 flex gap-3">
          <input
            type="text"
            placeholder="Rule name"
            value={newRuleName}
            onChange={(e) => setNewRuleName(e.target.value)}
            className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <select
            value={newRuleTargetType}
            onChange={(e) => setNewRuleTargetType(e.target.value)}
            className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="queue">Queue</option>
            <option value="group">Group</option>
            <option value="agent">Agent</option>
          </select>
          <input
            type="text"
            placeholder="Target ID"
            value={newRuleTargetId}
            onChange={(e) => setNewRuleTargetId(e.target.value)}
            className="w-32 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
          <button
            onClick={createRule}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Add Rule
          </button>
        </div>
      </section>

      {/* AGENT MANAGEMENT */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Agent Skills & Availability</h2>
        <div className="mt-6">
          {agents.length > 0 ? (
            <div className="space-y-4">
              {agents.map((a) => (
                <div key={a.userId} className="flex items-center justify-between border border-zinc-200 p-4">
                  <div className="flex items-center gap-3">
                    <AgentAvailabilityIndicator status={a.status} />
                    <span className="font-bold">{a.userName}</span>
                    <span className="font-mono text-xs text-zinc-500">({a.status})</span>
                  </div>
                  <AgentSkillBadges skills={getAgentSkills(a.userId)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-sm text-zinc-500">
              No agents tracked yet. Set agent availability via the API or CLI.
            </p>
          )}
        </div>
      </section>

      {/* CLI REFERENCE */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">CLI Reference</h2>
        <div className="mt-6 space-y-3 font-mono text-sm">
          <div className="flex justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">cliaas routing status</code>
            <span className="text-zinc-500">Engine status</span>
          </div>
          <div className="flex justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">cliaas routing route &lt;ticketId&gt;</code>
            <span className="text-zinc-500">Route a ticket</span>
          </div>
          <div className="flex justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">cliaas routing queues</code>
            <span className="text-zinc-500">List queues</span>
          </div>
          <div className="flex justify-between">
            <code className="text-emerald-400">cliaas agents skills &lt;userId&gt; --set billing,technical</code>
            <span className="text-zinc-500">Set skills</span>
          </div>
        </div>
      </section>
    </main>
  );
}
