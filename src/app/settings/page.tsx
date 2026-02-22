import Link from "next/link";
import { getAllConnectorStatuses } from "@/lib/connector-service";
import ConnectorCard from "@/components/ConnectorCard";

const llmProviders = [
  {
    name: "Claude",
    id: "claude",
    desc: "Anthropic Claude Sonnet — best for nuanced support replies",
    envVar: "ANTHROPIC_API_KEY",
    configCmd: "cliaas config set-key claude sk-ant-...",
    model: "claude-sonnet-4-5-20250929",
  },
  {
    name: "OpenAI",
    id: "openai",
    desc: "GPT-4o — fast, versatile general-purpose model",
    envVar: "OPENAI_API_KEY",
    configCmd: "cliaas config set-key openai sk-...",
    model: "gpt-4o",
  },
  {
    name: "OpenClaw / Custom",
    id: "openclaw",
    desc: "Any OpenAI-compatible endpoint: OpenClaw, Ollama, Together, LM Studio",
    envVar: "OPENCLAW_API_KEY (optional)",
    configCmd:
      "cliaas config set-openclaw --base-url http://localhost:18789/v1 --model gpt-4o",
    model: "configurable",
  },
];

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const connectors = getAllConnectorStatuses();

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Settings</span>
        </nav>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Settings
        </p>
        <h1 className="mt-4 text-4xl font-bold">Configuration</h1>
        <p className="mt-4 text-lg font-medium text-zinc-600">
          Manage helpdesk connectors, verify credentials, and pull data from
          each platform. All credentials are stored in environment variables.
        </p>
      </header>

      {/* CONNECTORS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Helpdesk Connectors</h2>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          {connectors.filter(c => c.configured).length} of {connectors.length} connectors configured
        </p>
        <div className="mt-6 space-y-6">
          {connectors.map((c) => (
            <ConnectorCard key={c.id} connector={c} />
          ))}
        </div>
      </section>

      {/* LLM PROVIDERS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">LLM Providers</h2>
        <p className="mt-2 text-sm font-medium text-zinc-600">
          Select your preferred LLM for triage, drafting, KB suggestions, and
          summaries. All providers use the same prompt pipeline.
        </p>
        <div className="mt-6 space-y-6">
          {llmProviders.map((p) => (
            <div key={p.id} className="border-2 border-zinc-200 p-5">
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold">{p.name}</p>
                <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
                  {p.model}
                </code>
              </div>
              <p className="mt-1 text-sm font-medium text-zinc-600">
                {p.desc}
              </p>
              <div className="mt-3">
                <code className="bg-zinc-950 px-2 py-1 font-mono text-xs text-emerald-400">
                  {p.envVar}
                </code>
              </div>
              <code className="mt-4 block border-t-2 border-zinc-200 bg-zinc-950 p-4 font-mono text-sm text-emerald-400">
                {p.configCmd}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* QUICK COMMANDS */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">Quick Commands</h2>
        <div className="mt-6 space-y-3 font-mono text-sm">
          <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">cliaas config show</code>
            <span className="text-zinc-500">View current config</span>
          </div>
          <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">
              cliaas config set-provider claude
            </code>
            <span className="text-zinc-500">Set LLM provider</span>
          </div>
          <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
            <code className="text-emerald-400">
              cliaas config set-key claude sk-ant-...
            </code>
            <span className="text-zinc-500">Set API key</span>
          </div>
          <div className="flex items-start justify-between">
            <code className="text-emerald-400">
              cliaas config set-openclaw --base-url ... --model ...
            </code>
            <span className="text-zinc-500">Custom endpoint</span>
          </div>
        </div>
      </section>
    </main>
  );
}
