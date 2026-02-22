import Link from "next/link";

const coreFeatures = [
  {
    title: "Exfiltrate Everything",
    text: "Pull tickets, users, KB articles, macros, triggers, and SLA policies from Zendesk and Kayako via their real APIs. JSONL output, cursor-based sync.",
  },
  {
    title: "LLM-Powered Triage",
    text: "Feed your ticket queue to Claude, GPT-4o, or any OpenAI-compatible model. Get priority, category, and assignment suggestions in seconds.",
  },
  {
    title: "Draft, Suggest, Summarize",
    text: "Generate context-aware replies, surface relevant KB articles, and produce shift summaries — all from the terminal.",
  },
];

const providers = [
  { name: "Claude", desc: "Anthropic Claude Sonnet" },
  { name: "OpenAI", desc: "GPT-4o" },
  { name: "OpenClaw", desc: "Any OpenAI-compatible endpoint" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 text-zinc-950 sm:px-10">
      {/* HEADER SECTION */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <p className="font-mono text-sm font-bold uppercase tracking-widest text-zinc-950">
          COMMAND-LINE NATIVE
        </p>
        <h1 className="mt-6 max-w-4xl text-4xl font-bold leading-none sm:text-7xl">
          Replace your helpdesk UI with a CLI that actually works.
        </h1>
        <p className="mt-6 max-w-2xl text-lg font-medium text-zinc-600">
          CLIaaS exports your Zendesk and Kayako data, then runs LLM-powered
          triage, drafts, and KB suggestions from the terminal. No browser tabs.
          No per-seat licensing. Just your data and an LLM.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="border-2 border-zinc-950 bg-zinc-950 px-8 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 hover:text-white"
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

      {/* TERMINAL SECTION */}
      <section className="mt-8 border-2 border-zinc-950 bg-zinc-950 p-6 text-zinc-100 sm:p-8">
        <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
            Real CLI — Real APIs
          </p>
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-zinc-700"></div>
            <div className="h-3 w-3 rounded-full bg-zinc-700"></div>
            <div className="h-3 w-3 rounded-full bg-zinc-700"></div>
          </div>
        </div>
        <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
          <span className="text-emerald-400">$ cliaas zendesk export --subdomain acme --out ./data</span>{"\n"}
          Exporting tickets... 2,847 tickets exported (12,403 messages){"\n"}
          Exporting users... 342 users exported{"\n"}
          Exporting organizations... 28 organizations exported{"\n"}
          Exporting KB articles... 89 articles exported{"\n"}
          Exporting business rules... 47 business rules exported{"\n\n"}

          <span className="text-emerald-400">$ cliaas triage --limit 5</span>{"\n"}
          #4521 <span className="text-red-400">[URGENT]</span> {'"Billing error on invoice #2026-0142"'} {"→"} billing, assign:sarah{"\n"}
          #4519 <span className="text-orange-400">[HIGH]</span>   {'"Can\'t reset password"'}                {"→"} auth, assign:mike{"\n"}
          #4518 <span className="text-yellow-400">[NORMAL]</span> {'"Feature request: dark mode"'}           {"→"} product, assign:backlog{"\n"}
          #4517 <span className="text-yellow-400">[NORMAL]</span> {'"Slow load times on dashboard"'}         {"→"} engineering, assign:ops{"\n"}
          #4515 <span className="text-zinc-500">[LOW]</span>    {'"Update company address"'}               {"→"} admin, assign:support{"\n\n"}

          <span className="text-emerald-400">$ cliaas draft reply --ticket 4521 --tone professional</span>{"\n"}
          {"Draft: \"Hi Sarah, I've reviewed invoice #INV-2026-0142 and can confirm"}{"\n"}
          {"the billing discrepancy. I've issued a corrective credit of $47.50"}{"\n"}
          {"which will appear on your next statement...\""}{"\n"}
          <span className="text-zinc-500">[approve] [edit] [discard]</span>
        </pre>
      </section>

      {/* FEATURES SECTION */}
      <section className="mt-8 grid gap-6 sm:grid-cols-3">
        {coreFeatures.map((feature) => (
          <article
            key={feature.title}
            className="border-2 border-zinc-950 bg-white p-6"
          >
            <h2 className="text-xl font-bold">{feature.title}</h2>
            <p className="mt-3 text-sm font-medium leading-relaxed text-zinc-600">{feature.text}</p>
          </article>
        ))}
      </section>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {/* PROVIDERS SECTION */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">LLM Providers</h2>
          <p className="mt-2 text-sm font-medium text-zinc-600">
            Choose your model. All three providers use the same prompt pipeline.
          </p>
          <div className="mt-6 flex flex-col gap-4">
            {providers.map((p) => (
              <div
                key={p.name}
                className="flex flex-col justify-center border-l-4 border-zinc-950 pl-4"
              >
                <p className="font-bold">{p.name}</p>
                <p className="text-sm font-medium text-zinc-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ROUTES SECTION */}
        <section className="border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-2xl font-bold">Internal Routes</h2>
          <div className="mt-6 flex flex-col gap-4 font-mono text-sm">
            {[
              { path: "/dashboard", note: "live metrics + connector status" },
              { path: "/tickets", note: "browse and filter ticket queue" },
              { path: "/kb", note: "knowledge base article browser" },
              { path: "/demo", note: "interactive terminal playground" },
              { path: "/settings", note: "credentials + LLM provider config" },
              { path: "/api/health", note: "deploy healthcheck" },
              { path: "/api/connectors", note: "Zendesk + Kayako connector specs" },
            ].map((route) => (
              <div
                key={route.path}
                className="flex items-start justify-between border-b border-zinc-200 pb-3 last:border-0 last:pb-0"
              >
                <Link href={route.path} className="font-bold hover:underline">
                  {route.path}
                </Link>
                <span className="ml-4 text-right text-zinc-500">{route.note}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}