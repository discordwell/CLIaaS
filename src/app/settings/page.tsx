import Link from "next/link";

const connectors = [
  {
    name: "Zendesk",
    direction: "bidirectional",
    status: "ready",
    fields: ["Subdomain", "Agent Email", "API Token"],
    configCmd: "cliaas zendesk export --subdomain <x> --email <e> --token <t>",
  },
  {
    name: "Kayako",
    direction: "bidirectional",
    status: "ready",
    fields: ["Domain", "Agent Email", "Password"],
    configCmd: "cliaas kayako export --domain <x> --email <e> --password <p>",
  },
];

const llmProviders = [
  {
    name: "Claude",
    id: "claude",
    desc: "Anthropic Claude Sonnet — best for nuanced support replies",
    configCmd: "cliaas config set-key claude sk-ant-...",
  },
  {
    name: "OpenAI",
    id: "openai",
    desc: "GPT-4o — fast, versatile general-purpose model",
    configCmd: "cliaas config set-key openai sk-...",
  },
  {
    name: "OpenClaw / Custom",
    id: "openclaw",
    desc: "Any OpenAI-compatible endpoint: OpenClaw, Ollama, Together, LM Studio",
    configCmd: "cliaas config set-openclaw --base-url http://localhost:18789/v1 --model gpt-4o",
  },
];

export default function SettingsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-foreground">
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="mb-6">
          <Link href="/dashboard" className="font-mono text-sm font-bold text-muted hover:text-foreground">
            ← BACK TO DASHBOARD
          </Link>
        </div>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
          Settings
        </p>
        <h1 className="mt-4 text-4xl font-bold">Configuration</h1>
        <p className="mt-4 text-lg font-medium text-muted">
          All credentials are stored locally in{" "}
          <code className="bg-inverted px-2 py-1 font-mono text-sm text-inverted-fg">~/.cliaas/config.json</code>.
          Configure via CLI commands below.
        </p>
      </header>

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">Helpdesk Connectors</h2>
        <div className="mt-6 space-y-6">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="border-2 border-line p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold">{c.name}</p>
                  <p className="font-mono text-xs font-bold uppercase text-muted">{c.direction}</p>
                </div>
                <span className="border-2 border-line bg-emerald-400 px-3 py-1 font-mono text-xs font-bold uppercase text-black">
                  {c.status}
                </span>
              </div>
              <div className="mt-5 space-y-2">
                <p className="font-mono text-xs font-bold uppercase text-muted">Required credentials:</p>
                <div className="flex flex-wrap gap-2">
                  {c.fields.map((f) => (
                    <span key={f} className="border-2 border-line bg-panel px-2 py-1 font-mono text-xs font-bold uppercase text-foreground">{f}</span>
                  ))}
                </div>
              </div>
              <code className="mt-5 block border-t-2 border-line bg-zinc-950 p-4 font-mono text-sm text-emerald-400">
                {c.configCmd}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">LLM Providers</h2>
        <p className="mt-2 text-sm font-medium text-muted">
          Select your preferred LLM for triage, drafting, KB suggestions, and summaries.
        </p>
        <div className="mt-6 space-y-6">
          {llmProviders.map((p) => (
            <div
              key={p.id}
              className="border-2 border-line p-5"
            >
              <p className="text-lg font-bold">{p.name}</p>
              <p className="mt-1 text-sm font-medium text-muted">{p.desc}</p>
              <code className="mt-4 block border-t-2 border-line bg-zinc-950 p-4 font-mono text-sm text-emerald-400">
                {p.configCmd}
              </code>
            </div>
          ))}
        </div>
        <div className="mt-6 border-2 border-line bg-accent-soft p-5">
          <p className="font-mono text-xs font-bold uppercase text-foreground">Switch active provider:</p>
          <code className="mt-2 block font-mono text-sm font-bold text-foreground">
            cliaas config set-provider claude|openai|openclaw
          </code>
        </div>
      </section>

      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold">View Current Config</h2>
        <code className="mt-4 block border-2 border-line bg-zinc-950 p-4 font-mono text-sm font-bold text-emerald-400">
          cliaas config show
        </code>
      </section>
    </main>
  );
}
