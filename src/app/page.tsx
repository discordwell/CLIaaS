import Link from "next/link";

const connectors = [
  { name: "Zendesk", status: "Live", desc: "Cursor-based incremental sync via REST API" },
  { name: "Kayako Cloud", status: "Live", desc: "Full export via HTTP client + offset pagination" },
  { name: "Kayako Classic", status: "Live", desc: "HMAC-SHA256 authenticated REST connector" },
];

const workflows = [
  {
    cmd: "cliaas triage",
    title: "Triage",
    desc: "LLM prioritizes, categorizes, and suggests assignment for open tickets",
  },
  {
    cmd: "cliaas draft reply",
    title: "Draft",
    desc: "Generate context-aware replies using ticket history and KB articles",
  },
  {
    cmd: "cliaas kb suggest",
    title: "KB Suggest",
    desc: "Surface the most relevant knowledge base articles for any ticket",
  },
  {
    cmd: "cliaas summarize",
    title: "Summarize",
    desc: "Produce shift summaries with priority breakdown and action items",
  },
];

const providers = [
  { name: "Claude", tag: "Anthropic", color: "bg-orange-500" },
  { name: "GPT-4o", tag: "OpenAI", color: "bg-emerald-500" },
  { name: "OpenClaw", tag: "Any endpoint", color: "bg-violet-500" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 text-zinc-950 sm:px-10">
      {/* HERO */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-emerald-500"></div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Live on cliaas.com
          </p>
        </div>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-[0.95] sm:text-7xl">
          Your helpdesk,
          <br />
          <span className="text-zinc-400">minus the UI.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-zinc-600">
          CLIaaS exfiltrates your entire Zendesk or Kayako instance — tickets,
          users, KB articles, macros, triggers, SLAs — then runs LLM-powered
          triage, reply drafting, and shift summaries from the terminal.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="border-2 border-zinc-950 bg-zinc-950 px-8 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800"
          >
            Open Dashboard
          </Link>
          <Link
            href="/demo"
            className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            Try Demo
          </Link>
          <a
            href="https://github.com/discordwell/CLIaaS"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-zinc-950 bg-white px-8 py-3 font-mono text-sm font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100"
          >
            GitHub
          </a>
        </div>
      </header>

      {/* LIVE CLI DEMO */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Real CLI — Real APIs — Real LLM Output
          </p>
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500/60"></div>
            <div className="h-3 w-3 rounded-full bg-yellow-500/60"></div>
            <div className="h-3 w-3 rounded-full bg-green-500/60"></div>
          </div>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-emerald-400">$ cliaas zendesk export</span>
          {"\n"}
          {"  "}Exporting tickets... 26 tickets exported (26 messages){"\n"}
          {"  "}Exporting users... 3 users exported{"\n"}
          {"  "}Exporting KB articles... 1 article exported{"\n"}
          {"  "}Exporting business rules... 21 rules exported{"\n"}
          <span className="text-zinc-600">{"  "}Export complete → ./exports/zendesk/manifest.json</span>
          {"\n\n"}
          <span className="text-emerald-400">$ cliaas triage --limit 3</span>
          {"\n"}
          {"  "}
          <span className="text-red-400">[URGENT]</span>
          {' #7  "Can\'t reset password" '}
          <span className="text-zinc-500">{"→"}</span>
          {" auth, assign:support-l2"}
          {"\n"}
          {"  "}
          <span className="text-orange-400">[HIGH]</span>
          {'   #4  "Requesting refund for duplicate charge" '}
          <span className="text-zinc-500">{"→"}</span>
          {" billing"}
          {"\n"}
          {"  "}
          <span className="text-yellow-400">[NORMAL]</span>
          {' #11 "Feature request: dark mode" '}
          <span className="text-zinc-500">{"→"}</span>
          {" product, assign:backlog"}
          {"\n\n"}
          <span className="text-emerald-400">$ cliaas draft reply --ticket zd-2</span>
          {"\n"}
          <span className="text-zinc-500">{"  "}Generating draft...</span>
          {"\n"}
          {"  "}
          {'"Hi, I\'ve reviewed invoice #2026-0142 and confirmed the billing'}
          {"\n"}
          {"  "}
          {'discrepancy. A corrective credit of $47.51 has been issued..."'}
          {"\n"}
          {"  "}
          <span className="text-zinc-500">[approve] [edit] [discard]</span>
        </pre>
      </section>

      {/* CONNECTORS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Connectors</h2>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            3 live integrations
          </p>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {connectors.map((c) => (
            <div
              key={c.name}
              className="border-2 border-zinc-200 p-4 transition-colors hover:border-zinc-950"
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-emerald-500"></div>
                <p className="font-mono text-xs font-bold uppercase text-emerald-600">
                  {c.status}
                </p>
              </div>
              <p className="mt-2 text-lg font-bold">{c.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WORKFLOWS */}
      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        {workflows.map((w) => (
          <article
            key={w.cmd}
            className="border-2 border-zinc-950 bg-white p-6"
          >
            <p className="font-mono text-xs font-bold text-zinc-400">
              $ {w.cmd}
            </p>
            <h3 className="mt-2 text-xl font-bold">{w.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-600">
              {w.desc}
            </p>
          </article>
        ))}
      </section>

      {/* BOTTOM ROW: PROVIDERS + ROUTES */}
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {/* LLM PROVIDERS */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">LLM Providers</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Same prompt pipeline, your choice of model.
          </p>
          <div className="mt-6 flex flex-col gap-4">
            {providers.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <div className={`h-3 w-3 ${p.color}`}></div>
                <div>
                  <p className="font-bold">{p.name}</p>
                  <p className="text-sm text-zinc-500">{p.tag}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ROUTES */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">Routes</h2>
          <div className="mt-6 flex flex-col gap-3 font-mono text-sm">
            {[
              { path: "/dashboard", note: "live metrics" },
              { path: "/tickets", note: "ticket queue" },
              { path: "/kb", note: "knowledge base" },
              { path: "/docs", note: "CLI documentation" },
              { path: "/demo", note: "terminal playground" },
              { path: "/settings", note: "config + credentials" },
              { path: "/api/health", note: "healthcheck" },
              { path: "/api/connectors", note: "connector specs" },
            ].map((route) => (
              <div
                key={route.path}
                className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
              >
                <Link href={route.path} className="font-bold hover:underline">
                  {route.path}
                </Link>
                <span className="text-zinc-400">{route.note}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* FOOTER */}
      <footer className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-center">
        <p className="font-mono text-sm text-zinc-400">
          Built for{" "}
          <span className="font-bold text-white">Zachathon 2026</span> by
          Robert Cordwell
        </p>
      </footer>
    </main>
  );
}
