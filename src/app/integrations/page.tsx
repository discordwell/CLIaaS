"use client";

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

// ---- Types ----

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  retryPolicy: { maxAttempts: number; delaysMs: number[] };
  createdAt: string;
  updatedAt: string;
}

interface WebhookLog {
  id: string;
  webhookId: string;
  event: string;
  status: "success" | "failed" | "pending";
  responseCode: number | null;
  timestamp: string;
  payload: Record<string, unknown>;
  attempt: number;
  error?: string;
}

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  hooks: string[];
  actions: Array<{ id: string; name: string; description: string }>;
  enabled: boolean;
  installedAt: string;
  config?: Record<string, unknown>;
}

interface SlackStatus {
  connected: boolean;
  webhookUrl: string;
  defaultChannel: string;
}

interface TeamsStatus {
  connected: boolean;
  webhookUrl: string;
}

// ---- Constants ----

const ALL_EVENTS = [
  "ticket.created",
  "ticket.updated",
  "ticket.resolved",
  "ticket.deleted",
  "message.created",
  "sla.breached",
  "csat.submitted",
  "agent.assigned",
  "tag.added",
  "tag.removed",
];

const statusColors: Record<string, string> = {
  success: "bg-emerald-500 text-white",
  failed: "bg-red-500 text-white",
  pending: "bg-amber-400 text-black",
};

type TabKey = "webhooks" | "slack-teams" | "plugins" | "api";

export default function IntegrationsPage() {
  const [tab, setTab] = useState<TabKey>("webhooks");

  // Webhooks state
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookForm, setWebhookForm] = useState({
    url: "",
    events: [] as string[],
    secret: "",
  });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [selectedWebhookLogs, setSelectedWebhookLogs] = useState<string | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Slack / Teams state
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus | null>(null);
  const [testingSlack, setTestingSlack] = useState(false);
  const [testingTeams, setTestingTeams] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<string | null>(null);
  const [teamsTestResult, setTeamsTestResult] = useState<string | null>(null);

  // Plugins state
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginLoading, setPluginLoading] = useState(true);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  // ---- Data loading ----

  const loadWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks");
      const data = await res.json();
      setWebhooks(data.webhooks || []);
    } catch {
      setWebhooks([]);
    } finally {
      setWebhookLoading(false);
    }
  }, []);

  const loadSlackTeams = useCallback(async () => {
    try {
      const [slackRes, teamsRes] = await Promise.all([
        fetch("/api/integrations/slack"),
        fetch("/api/integrations/teams"),
      ]);
      const slackData = await slackRes.json();
      const teamsData = await teamsRes.json();
      setSlackStatus(slackData);
      setTeamsStatus(teamsData);
    } catch {
      // silent fail
    }
  }, []);

  const loadPlugins = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins");
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch {
      setPlugins([]);
    } finally {
      setPluginLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWebhooks();
    loadSlackTeams();
    loadPlugins();
  }, [loadWebhooks, loadSlackTeams, loadPlugins]);

  // ---- Webhook handlers ----

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    setSavingWebhook(true);
    try {
      await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookForm.url,
          events: webhookForm.events,
          secret: webhookForm.secret || undefined,
        }),
      });
      setShowWebhookForm(false);
      setWebhookForm({ url: "", events: [], secret: "" });
      loadWebhooks();
    } finally {
      setSavingWebhook(false);
    }
  }

  async function toggleWebhook(id: string, enabled: boolean) {
    await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    loadWebhooks();
  }

  async function deleteWebhookById(id: string) {
    await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    if (selectedWebhookLogs === id) {
      setSelectedWebhookLogs(null);
      setWebhookLogs([]);
    }
    loadWebhooks();
  }

  async function viewLogs(webhookId: string) {
    if (selectedWebhookLogs === webhookId) {
      setSelectedWebhookLogs(null);
      setWebhookLogs([]);
      return;
    }
    setSelectedWebhookLogs(webhookId);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/webhooks/${webhookId}/logs`);
      const data = await res.json();
      setWebhookLogs(data.logs || []);
    } catch {
      setWebhookLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  function toggleEventSelection(event: string) {
    setWebhookForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  // ---- Slack / Teams handlers ----

  async function testSlack() {
    setTestingSlack(true);
    setSlackTestResult(null);
    try {
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      setSlackTestResult(data.ok ? "Test notification sent" : data.error || "Failed");
    } catch {
      setSlackTestResult("Failed to send test");
    } finally {
      setTestingSlack(false);
    }
  }

  async function testTeams() {
    setTestingTeams(true);
    setTeamsTestResult(null);
    try {
      const res = await fetch("/api/integrations/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      setTeamsTestResult(data.ok ? "Test notification sent" : data.error || "Failed");
    } catch {
      setTeamsTestResult("Failed to send test");
    } finally {
      setTestingTeams(false);
    }
  }

  // ---- Plugin handlers ----

  async function deletePlugin(id: string) {
    await fetch(`/api/plugins/${id}`, { method: "DELETE" });
    if (expandedPlugin === id) setExpandedPlugin(null);
    loadPlugins();
  }

  // ---- Tab definitions ----

  const tabs: { key: TabKey; label: string }[] = [
    { key: "webhooks", label: "Webhooks" },
    { key: "slack-teams", label: "Slack & Teams" },
    { key: "plugins", label: "Plugins" },
    { key: "api", label: "API" },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Platform
            </p>
            <h1 className="mt-2 text-3xl font-bold">Integrations Hub</h1>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
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

      {/* ============ WEBHOOKS TAB ============ */}
      {tab === "webhooks" && (
        <>
          {/* New webhook button */}
          <section className="mt-4 flex justify-end">
            <button
              onClick={() => setShowWebhookForm(!showWebhookForm)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {showWebhookForm ? "Cancel" : "New Webhook"}
            </button>
          </section>

          {/* Create form */}
          {showWebhookForm && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
              <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Create Webhook
              </h2>
              <form onSubmit={createWebhook} className="mt-4 space-y-4">
                <label className="block">
                  <span className="font-mono text-xs font-bold uppercase">
                    Endpoint URL
                  </span>
                  <input
                    type="url"
                    required
                    value={webhookForm.url}
                    onChange={(e) =>
                      setWebhookForm({ ...webhookForm, url: e.target.value })
                    }
                    className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    placeholder="https://hooks.example.com/cliaas"
                  />
                </label>

                <div>
                  <span className="font-mono text-xs font-bold uppercase">
                    Events
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ALL_EVENTS.map((evt) => (
                      <label
                        key={evt}
                        className={`flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-mono text-xs transition-colors ${
                          webhookForm.events.includes(evt)
                            ? "border-zinc-950 bg-zinc-950 text-white"
                            : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={webhookForm.events.includes(evt)}
                          onChange={() => toggleEventSelection(evt)}
                          className="sr-only"
                        />
                        {evt}
                      </label>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="font-mono text-xs font-bold uppercase">
                    Secret (optional)
                  </span>
                  <input
                    type="text"
                    value={webhookForm.secret}
                    onChange={(e) =>
                      setWebhookForm({ ...webhookForm, secret: e.target.value })
                    }
                    className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    placeholder="Auto-generated if blank"
                  />
                </label>

                <button
                  type="submit"
                  disabled={
                    savingWebhook || webhookForm.events.length === 0
                  }
                  className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {savingWebhook ? "Creating..." : "Create Webhook"}
                </button>
              </form>
            </section>
          )}

          {/* Webhook list */}
          {webhookLoading ? (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="font-mono text-sm text-zinc-500">
                Loading webhooks...
              </p>
            </section>
          ) : webhooks.length > 0 ? (
            <section className="mt-4 border-2 border-zinc-950 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                        URL
                      </th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                        Events
                      </th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                        Status
                      </th>
                      <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map((wh) => (
                      <tr
                        key={wh.id}
                        className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs break-all">
                            {wh.url}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {wh.events.map((e) => (
                              <span
                                key={e}
                                className="border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleWebhook(wh.id, wh.enabled)}
                            className={`font-mono text-xs font-bold uppercase ${
                              wh.enabled
                                ? "text-emerald-600"
                                : "text-zinc-400"
                            }`}
                          >
                            {wh.enabled ? "Active" : "Disabled"}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => viewLogs(wh.id)}
                              className={`font-mono text-xs font-bold uppercase ${
                                selectedWebhookLogs === wh.id
                                  ? "text-blue-600"
                                  : "text-zinc-500 hover:text-zinc-900"
                              }`}
                            >
                              Logs
                            </button>
                            <button
                              onClick={() => deleteWebhookById(wh.id)}
                              className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No webhooks configured</p>
              <p className="mt-2 text-sm text-zinc-600">
                Create a webhook to receive event notifications via HTTP POST.
              </p>
            </section>
          )}

          {/* Delivery logs */}
          {selectedWebhookLogs && (
            <section className="mt-4 border-2 border-zinc-950 bg-white">
              <div className="border-b-2 border-zinc-200 p-4">
                <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Delivery Logs for {selectedWebhookLogs}
                </h3>
              </div>

              {logsLoading ? (
                <div className="p-6 text-center">
                  <p className="font-mono text-sm text-zinc-500">
                    Loading logs...
                  </p>
                </div>
              ) : webhookLogs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Event
                        </th>
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Status
                        </th>
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Code
                        </th>
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Attempt
                        </th>
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Time
                        </th>
                        <th className="px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {webhookLogs
                        .sort(
                          (a, b) =>
                            new Date(b.timestamp).getTime() -
                            new Date(a.timestamp).getTime()
                        )
                        .map((log) => (
                          <tr
                            key={log.id}
                            className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                          >
                            <td className="px-4 py-2 font-mono text-xs">
                              {log.event}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                                  statusColors[log.status] ?? "bg-zinc-200"
                                }`}
                              >
                                {log.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">
                              {log.responseCode ?? "---"}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">
                              {log.attempt}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                              {new Date(log.timestamp).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-red-500">
                              {log.error ?? ""}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center">
                  <p className="font-mono text-sm text-zinc-500">
                    No delivery logs yet.
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ============ SLACK & TEAMS TAB ============ */}
      {tab === "slack-teams" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Slack */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Slack</h2>
              <span
                className={`font-mono text-xs font-bold uppercase ${
                  slackStatus?.connected
                    ? "text-emerald-600"
                    : "text-zinc-400"
                }`}
              >
                {slackStatus?.connected ? "Connected" : "Not configured"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Webhook URL
                </span>
                <p className="mt-1 font-mono text-sm text-zinc-700">
                  {slackStatus?.webhookUrl || "Not set"}
                </p>
              </div>
              <div>
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Default Channel
                </span>
                <p className="mt-1 font-mono text-sm text-zinc-700">
                  {slackStatus?.defaultChannel || "#support"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Configuration
                </span>
                <p className="mt-1 text-sm text-zinc-600">
                  Set <code className="bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">SLACK_WEBHOOK_URL</code> in your environment variables to enable Slack notifications.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={testSlack}
                  disabled={testingSlack}
                  className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {testingSlack ? "Testing..." : "Test Connection"}
                </button>
                {slackTestResult && (
                  <span
                    className={`font-mono text-xs font-bold ${
                      slackTestResult.includes("sent")
                        ? "text-emerald-600"
                        : "text-red-500"
                    }`}
                  >
                    {slackTestResult}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 border-t border-zinc-200 pt-4">
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                Slash Commands
              </span>
              <div className="mt-2 space-y-1 font-mono text-xs text-zinc-600">
                <p>
                  <code className="bg-zinc-100 px-1.5 py-0.5">/cliaas create &lt;subject&gt;</code>{" "}
                  - Create a ticket
                </p>
                <p>
                  <code className="bg-zinc-100 px-1.5 py-0.5">/cliaas status</code>{" "}
                  - Check integration status
                </p>
              </div>
            </div>
          </section>

          {/* Teams */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Microsoft Teams</h2>
              <span
                className={`font-mono text-xs font-bold uppercase ${
                  teamsStatus?.connected
                    ? "text-emerald-600"
                    : "text-zinc-400"
                }`}
              >
                {teamsStatus?.connected ? "Connected" : "Not configured"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Webhook URL
                </span>
                <p className="mt-1 font-mono text-sm text-zinc-700">
                  {teamsStatus?.webhookUrl || "Not set"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                  Configuration
                </span>
                <p className="mt-1 text-sm text-zinc-600">
                  Set <code className="bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">TEAMS_WEBHOOK_URL</code> in your environment variables to enable Teams notifications.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={testTeams}
                  disabled={testingTeams}
                  className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {testingTeams ? "Testing..." : "Test Connection"}
                </button>
                {teamsTestResult && (
                  <span
                    className={`font-mono text-xs font-bold ${
                      teamsTestResult.includes("sent")
                        ? "text-emerald-600"
                        : "text-red-500"
                    }`}
                  >
                    {teamsTestResult}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 border-t border-zinc-200 pt-4">
              <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                Bot Commands
              </span>
              <div className="mt-2 space-y-1 font-mono text-xs text-zinc-600">
                <p>
                  <code className="bg-zinc-100 px-1.5 py-0.5">create &lt;subject&gt;</code>{" "}
                  - Create a ticket
                </p>
                <p>
                  <code className="bg-zinc-100 px-1.5 py-0.5">status</code>{" "}
                  - Check integration status
                </p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ============ PLUGINS TAB ============ */}
      {tab === "plugins" && (
        <>
          {pluginLoading ? (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="font-mono text-sm text-zinc-500">
                Loading plugins...
              </p>
            </section>
          ) : plugins.length > 0 ? (
            <section className="mt-4 space-y-2">
              {plugins.map((plugin) => {
                const isExpanded = expandedPlugin === plugin.id;
                return (
                  <div
                    key={plugin.id}
                    className="border-2 border-zinc-950 bg-white"
                  >
                    <button
                      onClick={() =>
                        setExpandedPlugin(isExpanded ? null : plugin.id)
                      }
                      className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-zinc-50"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="text-base font-bold">
                            {plugin.name}
                          </span>
                          <span className="font-mono text-xs text-zinc-400">
                            v{plugin.version}
                          </span>
                          <span
                            className={`font-mono text-xs font-bold uppercase ${
                              plugin.enabled
                                ? "text-emerald-600"
                                : "text-zinc-400"
                            }`}
                          >
                            {plugin.enabled ? "Active" : "Disabled"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">
                          {plugin.description}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-zinc-400">
                        {isExpanded ? "[-]" : "[+]"}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-200 p-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                              Author
                            </span>
                            <p className="mt-1 text-sm">{plugin.author}</p>
                          </div>
                          <div>
                            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                              Installed
                            </span>
                            <p className="mt-1 font-mono text-sm text-zinc-600">
                              {new Date(plugin.installedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4">
                          <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                            Event Hooks
                          </span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {plugin.hooks.map((hook) => (
                              <span
                                key={hook}
                                className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
                              >
                                {hook}
                              </span>
                            ))}
                          </div>
                        </div>

                        {plugin.actions.length > 0 && (
                          <div className="mt-4">
                            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                              Actions
                            </span>
                            <div className="mt-2 space-y-2">
                              {plugin.actions.map((action) => (
                                <div
                                  key={action.id}
                                  className="border border-zinc-200 p-3"
                                >
                                  <p className="font-mono text-xs font-bold">
                                    {action.name}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-600">
                                    {action.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {plugin.config && (
                          <div className="mt-4">
                            <span className="font-mono text-xs font-bold uppercase text-zinc-500">
                              Configuration
                            </span>
                            <pre className="mt-2 overflow-x-auto bg-zinc-100 p-3 font-mono text-xs">
                              {JSON.stringify(plugin.config, null, 2)}
                            </pre>
                          </div>
                        )}

                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => deletePlugin(plugin.id)}
                            className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                          >
                            Uninstall
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No plugins installed</p>
              <p className="mt-2 text-sm text-zinc-600">
                Register plugins via the API to extend CLIaaS functionality.
              </p>
            </section>
          )}
        </>
      )}

      {/* ============ API TAB ============ */}
      {tab === "api" && (
        <div className="mt-4 space-y-4">
          {/* API Documentation link */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">API Documentation</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Full interactive API reference with request/response schemas.
            </p>
            <Link
              href="/docs"
              className="mt-4 inline-block border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              View API Docs
            </Link>
          </section>

          {/* API Key */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">API Key</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Use your API key to authenticate requests. Include it in the{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 font-mono text-xs">
                X-API-Key
              </code>{" "}
              header.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <code className="flex-1 border-2 border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm">
                cliaas_live_••••••••••••••••••••
              </code>
              <button className="border-2 border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:border-zinc-950">
                Reveal
              </button>
              <button className="border-2 border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:border-zinc-950">
                Regenerate
              </button>
            </div>
          </section>

          {/* Rate Limits */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Rate Limits</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                      Tier
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                      Requests/min
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                      Burst
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                      Webhooks
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">Free</td>
                    <td className="px-4 py-3 font-mono">60</td>
                    <td className="px-4 py-3 font-mono">10</td>
                    <td className="px-4 py-3 font-mono">3</td>
                  </tr>
                  <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">Pro</td>
                    <td className="px-4 py-3 font-mono">600</td>
                    <td className="px-4 py-3 font-mono">50</td>
                    <td className="px-4 py-3 font-mono">25</td>
                  </tr>
                  <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">Enterprise</td>
                    <td className="px-4 py-3 font-mono">6000</td>
                    <td className="px-4 py-3 font-mono">200</td>
                    <td className="px-4 py-3 font-mono">Unlimited</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Authentication */}
          <section className="border-2 border-zinc-950 bg-white p-6">
            <h2 className="text-lg font-bold">Authentication</h2>
            <p className="mt-2 text-sm text-zinc-600">
              CLIaaS supports two authentication methods:
            </p>
            <div className="mt-4 space-y-3">
              <div className="border border-zinc-200 p-4">
                <p className="font-mono text-xs font-bold uppercase">
                  Bearer Token (JWT)
                </p>
                <code className="mt-2 block bg-zinc-100 p-2 font-mono text-xs text-zinc-700">
                  Authorization: Bearer &lt;token&gt;
                </code>
              </div>
              <div className="border border-zinc-200 p-4">
                <p className="font-mono text-xs font-bold uppercase">
                  API Key
                </p>
                <code className="mt-2 block bg-zinc-100 p-2 font-mono text-xs text-zinc-700">
                  X-API-Key: cliaas_live_...
                </code>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
