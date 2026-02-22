import Link from "next/link";

const connectors = [
  {
    name: "Zendesk",
    direction: "bidirectional",
    status: "ready",
    fields: ["Subdomain", "Agent Email", "API Token"],
    envVars: ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_TOKEN"],
    configCmd:
      "cliaas zendesk export --subdomain <x> --email <e> --token <t>",
  },
  {
    name: "Kayako",
    direction: "bidirectional",
    status: "ready",
    fields: ["Domain", "Agent Email", "Password"],
    envVars: ["KAYAKO_DOMAIN", "KAYAKO_EMAIL", "KAYAKO_PASSWORD"],
    configCmd: "cliaas kayako export --domain <x> --email <e> --password <p>",
  },
];

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

export default function SettingsPage() {
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
          CLIaaS is configured via CLI commands or environment variables. All
          credentials are stored locally in{" "}
          <code className="bg-zinc-100 px-2 py-1 font-mono text-sm">
            ~/.cliaas/config.json
          </code>{" "}
          with 0600 permissions.
        </p>
      </header>

      {/* CONNECTORS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
        <h2 className="text-2xl font-bold">Helpdesk Connectors</h2>
        <div className="mt-6 space-y-6">
          {connectors.map((c) => (
            <div key={c.name} className="border-2 border-zinc-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold">{c.name}</p>
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    {c.direction}
                  </p>
                </div>
                <span className="border-2 border-zinc-950 bg-emerald-400 px-3 py-1 font-mono text-xs font-bold uppercase text-black">
                  {c.status}
                </span>
              </div>
              <div className="mt-5 space-y-3">
                <div>
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Required credentials:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.fields.map((f) => (
                      <span
                        key={f}
                        className="border border-zinc-300 bg-zinc-100 px-2 py-1 font-mono text-xs font-bold"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                    Environment variables:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.envVars.map((v) => (
                      <code
                        key={v}
                        className="bg-zinc-950 px-2 py-1 font-mono text-xs text-emerald-400"
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
              <code className="mt-5 block border-t-2 border-zinc-200 bg-zinc-950 p-4 font-mono text-sm text-emerald-400">
                {c.configCmd}
              </code>
            </div>
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
        <div className="mt-6 border-2 border-zinc-950 bg-zinc-100 p-5">
          <p className="font-mono text-xs font-bold uppercase text-zinc-950">
            Switch active provider:
          </p>
          <code className="mt-2 block font-mono text-sm font-bold text-zinc-950">
            cliaas config set-provider claude|openai|openclaw
          </code>
        </div>
      </section>

      {/* CONFIG REFERENCE */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
        <h2 className="text-2xl font-bold text-white">Config File Reference</h2>
        <pre className="mt-6 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-zinc-500">
            {"// ~/.cliaas/config.json (0600 permissions)"}
          </span>
          {"\n"}
          {"{\n"}
          {'  "provider": "claude",\n'}
          {'  "claude": {\n'}
          {'    "apiKey": "sk-ant-...",\n'}
          {'    "model": "claude-sonnet-4-5-20250929"\n'}
          {"  },\n"}
          {'  "openai": {\n'}
          {'    "apiKey": "sk-...",\n'}
          {'    "model": "gpt-4o"\n'}
          {"  },\n"}
          {'  "openclaw": {\n'}
          {'    "baseUrl": "http://localhost:18789/v1",\n'}
          {'    "apiKey": "optional",\n'}
          {'    "model": "gpt-4o"\n'}
          {"  }\n"}
          {"}"}
        </pre>
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
