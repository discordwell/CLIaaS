import Link from "next/link";

const coreFeatures = [
  {
    title: "Command-Line First",
    text: "Everything in the product is exposed by a CLI before UI polish. No hidden-only workflows.",
  },
  {
    title: "Interoperable Data",
    text: "Import from existing SaaS, normalize to a schema, and export back to compatible formats.",
  },
  {
    title: "Migration Ready",
    text: "Use repeatable commands so users can script moves between vendors without manual copy/paste.",
  },
];

const launchRoutes = [
  { path: "/sign-up", note: "onboarding" },
  { path: "/dashboard", note: "workspace overview" },
  { path: "/settings", note: "connector + profile config" },
  { path: "/api/health", note: "deploy healthcheck" },
  { path: "/api/connectors", note: "available import/export providers" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 text-slate-900 sm:px-10">
      <header className="rounded-3xl border border-slate-200/80 bg-panel/90 p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          CLIAAS.COM
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
          CLIaaS builds SaaS products that work natively from the command line.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Hackathon skeleton ready: landing, auth, dashboard, settings, health API,
          and interoperability API stubs for import/export flows.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/sign-up"
            className="rounded-full bg-accent px-6 py-3 font-semibold text-white transition hover:brightness-95"
          >
            Get Started
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold transition hover:bg-slate-50"
          >
            Open Dashboard
          </Link>
        </div>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {coreFeatures.map((feature) => (
          <article
            key={feature.title}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-xl font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{feature.text}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-300">
          Example CLI Flow
        </p>
        <pre className="mt-3 overflow-x-auto font-mono text-sm leading-7 text-cyan-100">
{`$ cliaas auth login
$ cliaas import --from notion --workspace acme --out ./exports/notion.json
$ cliaas sync --target cliaas --input ./exports/notion.json
$ cliaas export --to csv --workspace acme --out ./exports/acme.csv`}
        </pre>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Launch Route Map</h2>
        <div className="mt-4 grid gap-2 font-mono text-sm">
          {launchRoutes.map((route) => (
            <div
              key={route.path}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
            >
              <Link href={route.path} className="text-accent underline-offset-2 hover:underline">
                {route.path}
              </Link>
              <span className="text-muted">{route.note}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
