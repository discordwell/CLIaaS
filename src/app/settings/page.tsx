const connectors = [
  { name: "Notion", direction: "bidirectional", status: "ready" },
  { name: "Trello", direction: "import", status: "building" },
  { name: "Airtable", direction: "export", status: "planned" },
];

export default function SettingsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Workspace configuration</h1>
        <p className="mt-2 text-muted">
          Hook these settings to your database/auth provider once target SaaS is finalized.
        </p>
      </header>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Connectors</h2>
        <div className="mt-4 space-y-3">
          {connectors.map((connector) => (
            <div
              key={connector.name}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
            >
              <div>
                <p className="font-semibold">{connector.name}</p>
                <p className="font-mono text-xs text-muted">{connector.direction}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {connector.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">CLI Token</h2>
        <p className="mt-2 text-sm text-muted">
          Placeholder token for local command-line integration during hackathon development.
        </p>
        <code className="mt-4 block rounded-lg bg-slate-900 px-4 py-3 font-mono text-sm text-cyan-100">
          cliaas_hackathon_dev_token_replace_me
        </code>
      </section>
    </main>
  );
}
