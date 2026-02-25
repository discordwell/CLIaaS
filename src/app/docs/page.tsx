"use client";

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import { useEffect, useState, useCallback } from "react";

// ---- OpenAPI Types ----

interface PathOperation {
  summary?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: { type?: string; enum?: string[]; format?: string };
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, { description?: string }>;
}

interface PathItem {
  [method: string]: PathOperation;
}

interface OpenAPISpec {
  info: { title: string; version: string; description: string };
  paths: Record<string, PathItem>;
  tags?: Array<{ name: string; description?: string }>;
}

// ---- CLI command data (preserved from original) ----

const cliCommands = [
  { name: "zendesk verify", desc: "Test Zendesk API connectivity and authentication", usage: "cliaas zendesk verify --subdomain <x> --email <e> --token <t>", flags: ["--subdomain", "--email", "--token"] },
  { name: "zendesk export", desc: "Export tickets, users, orgs, KB articles, and business rules from Zendesk", usage: "cliaas zendesk export --subdomain <x> --email <e> --token <t> --out ./exports/zendesk", flags: ["--subdomain", "--email", "--token", "--out"] },
  { name: "zendesk sync", desc: "Incremental sync using cursor state from a previous export", usage: "cliaas zendesk sync --out ./exports/zendesk", flags: ["--subdomain", "--email", "--token", "--out"] },
  { name: "zendesk update", desc: "Update a Zendesk ticket (status, priority, assignee, tags)", usage: "cliaas zendesk update --ticket <id> --status solved --priority high", flags: ["--ticket", "--status", "--priority", "--assignee", "--tags", "--subdomain", "--email", "--token"] },
  { name: "zendesk reply", desc: "Post a public reply or internal note to a Zendesk ticket", usage: 'cliaas zendesk reply --ticket <id> --body "Your issue has been resolved." [--internal]', flags: ["--ticket", "--body", "--internal", "--subdomain", "--email", "--token"] },
  { name: "zendesk create", desc: "Create a new Zendesk ticket", usage: 'cliaas zendesk create --subject "Bug report" --body "Steps to reproduce..."', flags: ["--subject", "--body", "--priority", "--tags", "--assignee", "--subdomain", "--email", "--token"] },
  { name: "kayako verify", desc: "Test Kayako API connectivity and authentication", usage: "cliaas kayako verify --domain <x> --email <e> --password <p>", flags: ["--domain", "--email", "--password"] },
  { name: "kayako export", desc: "Export cases, users, orgs, and KB articles from Kayako", usage: "cliaas kayako export --domain <x> --email <e> --password <p> --out ./exports/kayako", flags: ["--domain", "--email", "--password", "--out"] },
  { name: "tickets list", desc: "List and filter exported tickets", usage: "cliaas tickets list [--status open] [--priority high] [--assignee <name>]", flags: ["--status", "--priority", "--assignee", "--tag", "--source", "--sort", "--limit", "--dir"] },
  { name: "tickets search", desc: "Full-text search across subjects, tags, requesters, and message bodies", usage: "cliaas tickets search <query>", flags: ["--dir", "--limit"] },
  { name: "tickets show", desc: "Show ticket details with conversation thread", usage: "cliaas tickets show <id>", flags: ["--dir"] },
  { name: "triage", desc: "LLM-powered ticket triage with priority, category, and assignment suggestions", usage: "cliaas triage [--queue open] [--limit 10]", flags: ["--queue", "--limit", "--dir"] },
  { name: "draft reply", desc: "Generate an AI draft reply for a ticket", usage: "cliaas draft reply --ticket <id> [--tone professional]", flags: ["--ticket", "--tone", "--context", "--dir"] },
  { name: "pipeline", desc: "One-shot: triage open tickets, then draft replies for top-priority items", usage: "cliaas pipeline [--limit 10] [--draft-top 3] [--dry-run]", flags: ["--limit", "--draft-top", "--tone", "--dry-run", "--queue", "--dir"] },
  { name: "demo", desc: "Generate realistic sample data for testing (no API keys needed)", usage: "cliaas demo [--tickets 50] [--out ./exports/demo]", flags: ["--tickets", "--out"] },
];

const methodColors: Record<string, string> = {
  get: "bg-blue-500 text-white",
  post: "bg-emerald-500 text-white",
  patch: "bg-amber-400 text-black",
  put: "bg-orange-500 text-white",
  delete: "bg-red-500 text-white",
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

export default function DocsPage() {
  const [tab, setTab] = useState<"api" | "cli">("api");
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [filterTag, setFilterTag] = useState("");

  const loadSpec = useCallback(async () => {
    try {
      const res = await fetch("/api/docs");
      const data = await res.json();
      setSpec(data);
    } catch {
      setSpec(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSpec();
  }, [loadSpec]);

  function togglePath(key: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filteredPaths = spec
    ? Object.entries(spec.paths).filter(([, pathItem]) => {
        if (!filterTag) return true;
        return Object.values(pathItem).some(
          (op) =>
            typeof op === "object" &&
            op !== null &&
            "tags" in op &&
            Array.isArray((op as PathOperation).tags) &&
            (op as PathOperation).tags!.includes(filterTag)
        );
      })
    : [];

  const tabs = [
    { key: "api" as const, label: "REST API" },
    { key: "cli" as const, label: "CLI Reference" },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Documentation
          </p>
          <h1 className="mt-2 text-3xl font-bold">
            {spec?.info.title ?? "CLIaaS"} Documentation
          </h1>
          {spec && (
            <p className="mt-1 text-sm text-zinc-600">
              v{spec.info.version}
            </p>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="mt-6 flex gap-2">
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

      {/* API TAB */}
      {tab === "api" && (
        <>
          {/* Tag filters */}
          {spec?.tags && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-4">
              <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                Filter by tag
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterTag("")}
                  className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                    filterTag === ""
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
                  }`}
                >
                  All
                </button>
                {spec.tags.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => setFilterTag(tag.name)}
                    className={`border px-3 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                      filterTag === tag.name
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
                    }`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {loading && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="font-mono text-sm text-zinc-500">
                Loading API specification...
              </p>
            </section>
          )}

          {spec && !loading && (
            <section className="mt-4 space-y-2">
              {filteredPaths.map(([path, pathItem]) => {
                const methods = Object.entries(pathItem).filter(([m]) =>
                  HTTP_METHODS.includes(m)
                );

                return methods.map(([method, operation]) => {
                  const key = `${method}:${path}`;
                  const isExpanded = expandedPaths.has(key);
                  const op = operation as PathOperation;

                  return (
                    <div key={key} className="border-2 border-zinc-950 bg-white">
                      <button
                        onClick={() => togglePath(key)}
                        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
                      >
                        <span
                          className={`inline-block w-16 px-2 py-0.5 text-center font-mono text-xs font-bold uppercase ${
                            methodColors[method] ?? "bg-zinc-200"
                          }`}
                        >
                          {method}
                        </span>
                        <span className="font-mono text-sm font-bold">{path}</span>
                        <span className="ml-auto text-sm text-zinc-500">
                          {op.summary ?? ""}
                        </span>
                        <span className="font-mono text-xs text-zinc-400">
                          {isExpanded ? "[-]" : "[+]"}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-zinc-200 p-4">
                          {op.summary && (
                            <p className="text-sm text-zinc-700">{op.summary}</p>
                          )}

                          {op.tags && op.tags.length > 0 && (
                            <div className="mt-2 flex gap-2">
                              {op.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-bold"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {op.parameters && op.parameters.length > 0 && (
                            <div className="mt-4">
                              <h4 className="font-mono text-xs font-bold uppercase text-zinc-500">
                                Parameters
                              </h4>
                              <table className="mt-2 w-full text-sm">
                                <thead>
                                  <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                                    <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                                      Name
                                    </th>
                                    <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                                      In
                                    </th>
                                    <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                                      Type
                                    </th>
                                    <th className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500">
                                      Required
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {op.parameters.map((param) => (
                                    <tr key={param.name} className="border-b border-zinc-100">
                                      <td className="px-3 py-2 font-mono font-bold">{param.name}</td>
                                      <td className="px-3 py-2 text-zinc-600">{param.in}</td>
                                      <td className="px-3 py-2 font-mono text-zinc-600">
                                        {param.schema?.type ?? "string"}
                                        {param.schema?.enum && ` [${param.schema.enum.join(", ")}]`}
                                      </td>
                                      <td className="px-3 py-2">
                                        {param.required ? (
                                          <span className="font-mono text-xs font-bold text-red-500">Yes</span>
                                        ) : (
                                          <span className="font-mono text-xs text-zinc-400">No</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {op.requestBody && (
                            <div className="mt-4">
                              <h4 className="font-mono text-xs font-bold uppercase text-zinc-500">
                                Request Body
                                {op.requestBody.required && (
                                  <span className="ml-2 text-red-500">required</span>
                                )}
                              </h4>
                              {op.requestBody.content && (
                                <pre className="mt-2 overflow-x-auto bg-zinc-100 p-3 font-mono text-xs">
                                  {JSON.stringify(
                                    Object.values(op.requestBody.content)[0]?.schema ?? {},
                                    null,
                                    2
                                  )}
                                </pre>
                              )}
                            </div>
                          )}

                          {op.responses && (
                            <div className="mt-4">
                              <h4 className="font-mono text-xs font-bold uppercase text-zinc-500">
                                Responses
                              </h4>
                              <div className="mt-2 space-y-1">
                                {Object.entries(op.responses).map(([code, resp]) => (
                                  <div key={code} className="flex items-center gap-3">
                                    <span
                                      className={`inline-block w-12 text-center font-mono text-xs font-bold ${
                                        code.startsWith("2")
                                          ? "text-emerald-600"
                                          : code.startsWith("4")
                                            ? "text-amber-600"
                                            : "text-red-600"
                                      }`}
                                    >
                                      {code}
                                    </span>
                                    <span className="text-sm text-zinc-600">
                                      {resp.description}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })}
            </section>
          )}

          {spec && !loading && filteredPaths.length === 0 && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No endpoints found</p>
              <p className="mt-2 text-sm text-zinc-600">
                Try selecting a different tag filter.
              </p>
            </section>
          )}
        </>
      )}

      {/* CLI TAB */}
      {tab === "cli" && (
        <>
          <section className="mt-4 border-2 border-zinc-950 bg-white">
            <div className="border-b-2 border-zinc-950 p-6">
              <h2 className="text-2xl font-bold">CLI Commands</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Install:{" "}
                <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
                  npm install -g cliaas
                </code>{" "}
                or run with{" "}
                <code className="bg-zinc-100 px-2 py-1 font-mono text-xs">
                  pnpm cliaas
                </code>
              </p>
            </div>
            <div className="divide-y divide-zinc-200">
              {cliCommands.map((cmd) => (
                <div key={cmd.name} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <code className="font-mono text-sm font-bold text-zinc-950">
                        cliaas {cmd.name}
                      </code>
                      <p className="mt-1 text-sm text-zinc-600">{cmd.desc}</p>
                    </div>
                  </div>
                  <code className="mt-3 block bg-zinc-950 p-3 font-mono text-xs text-emerald-400">
                    {cmd.usage}
                  </code>
                  {cmd.flags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {cmd.flags.map((f) => (
                        <span
                          key={f}
                          className="border border-zinc-300 px-2 py-0.5 font-mono text-xs text-zinc-500"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* QUICK START */}
          <section className="mt-4 border-2 border-zinc-950 bg-zinc-950 p-8 text-zinc-100">
            <h2 className="text-2xl font-bold text-white">Quick Start</h2>
            <pre className="mt-6 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
              <span className="text-zinc-500"># Generate demo data (no API keys needed)</span>{"\n"}
              <span className="text-emerald-400">cliaas demo --tickets 50</span>{"\n\n"}
              <span className="text-zinc-500"># Browse your tickets</span>{"\n"}
              <span className="text-emerald-400">cliaas tickets list --status open</span>{"\n"}
              <span className="text-emerald-400">cliaas stats</span>{"\n\n"}
              <span className="text-zinc-500"># Configure LLM and run AI workflows</span>{"\n"}
              <span className="text-emerald-400">cliaas config set-provider claude</span>{"\n"}
              <span className="text-emerald-400">cliaas triage --limit 10</span>{"\n"}
              <span className="text-emerald-400">cliaas pipeline --dry-run</span>
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
