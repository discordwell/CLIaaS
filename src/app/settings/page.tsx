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
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Configuration</h1>
        <p className="mt-2 text-muted">
          All credentials are stored locally in{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">~/.cliaas/config.json</code>.
          Configure via CLI commands below.
        </p>
      </header>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Helpdesk Connectors</h2>
        <div className="mt-4 space-y-4">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="rounded-lg border border-slate-200 px-4 py-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="font-mono text-xs text-muted">{c.direction}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {c.status}
                </span>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-xs font-semibold text-muted">Required credentials:</p>
                <div className="flex flex-wrap gap-2">
                  {c.fields.map((f) => (
                    <span key={f} className="rounded bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700">{f}</span>
                  ))}
                </div>
              </div>
              <code className="mt-3 block rounded bg-slate-900 px-3 py-2 font-mono text-xs text-cyan-100">
                {c.configCmd}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">LLM Providers</h2>
        <p className="mt-2 text-sm text-muted">
          Select your preferred LLM for triage, drafting, KB suggestions, and summaries.
        </p>
        <div className="mt-4 space-y-4">
          {llmProviders.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-slate-200 px-4 py-4"
            >
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-sm text-muted">{p.desc}</p>
              <code className="mt-2 block rounded bg-slate-900 px-3 py-2 font-mono text-xs text-cyan-100">
                {p.configCmd}
              </code>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold">Switch active provider:</p>
          <code className="mt-1 block font-mono text-xs text-slate-700">
            cliaas config set-provider claude|openai|openclaw
          </code>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">View Current Config</h2>
        <code className="mt-3 block rounded-lg bg-slate-900 px-4 py-3 font-mono text-sm text-cyan-100">
          cliaas config show
        </code>
      </section>
    </main>
  );
}
