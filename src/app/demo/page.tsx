"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

interface TermLine {
  text: string;
  type: "command" | "output" | "highlight" | "error" | "success" | "dim";
}

interface DemoScenario {
  command: string;
  output: TermLine[];
  delay?: number;
}

const SCENARIOS: DemoScenario[] = [
  {
    command: "cliaas --help",
    output: [
      { text: "Usage: cliaas [options] [command]", type: "output" },
      { text: "", type: "output" },
      { text: "CLI-as-a-Service: Replace legacy helpdesk SaaS with LLM-powered CLI workflows", type: "dim" },
      { text: "", type: "output" },
      { text: "Commands:", type: "output" },
      { text: "  zendesk              Zendesk data export and sync", type: "output" },
      { text: "  kayako               Kayako data export", type: "output" },
      { text: "  tickets              View, search, and manage exported tickets", type: "output" },
      { text: "  triage [options]     LLM-powered ticket triage", type: "highlight" },
      { text: "  draft                LLM-powered draft generation", type: "highlight" },
      { text: "  kb                   Knowledge base operations", type: "highlight" },
      { text: "  summarize [options]  LLM-powered queue/shift summary", type: "highlight" },
      { text: "  stats                Show queue metrics", type: "output" },
      { text: "  demo                 Generate sample data", type: "output" },
      { text: "  export               Export to CSV or Markdown", type: "output" },
      { text: "  config               Manage configuration", type: "output" },
    ],
  },
  {
    command: "cliaas zendesk export --subdomain acme --out ./data",
    output: [
      { text: "\u2714 2,847 tickets exported (12,403 messages)", type: "success" },
      { text: "\u2714 342 users exported", type: "success" },
      { text: "\u2714 28 organizations exported", type: "success" },
      { text: "\u2714 89 KB articles exported", type: "success" },
      { text: "\u2714 47 business rules exported", type: "success" },
      { text: "", type: "output" },
      { text: "Export complete \u2192 ./data/manifest.json", type: "highlight" },
    ],
    delay: 150,
  },
  {
    command: "cliaas stats --dir ./data",
    output: [
      { text: "", type: "output" },
      { text: "  CLIaaS Queue Statistics", type: "highlight" },
      { text: "", type: "output" },
      { text: "  Overview", type: "output" },
      { text: "  Tickets:             2,847", type: "output" },
      { text: "  Messages:            12,403", type: "output" },
      { text: "  KB Articles:         89", type: "output" },
      { text: "", type: "output" },
      { text: "  By Status", type: "output" },
      { text: "  open           847  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 30%", type: "success" },
      { text: "  pending        612  \u2588\u2588\u2588\u2588\u2588\u2588 22%", type: "highlight" },
      { text: "  solved        1102  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 39%", type: "dim" },
      { text: "  closed         286  \u2588\u2588\u2588 10%", type: "dim" },
      { text: "", type: "output" },
      { text: "  \u26a0 12 high/urgent tickets still open", type: "error" },
    ],
  },
  {
    command: "cliaas triage --limit 5",
    output: [
      { text: "#4521 [URGENT] \"Billing error on invoice\" \u2192 billing, assign:sarah", type: "error" },
      { text: "#4519 [HIGH]   \"Can't reset password\"     \u2192 auth, assign:mike", type: "highlight" },
      { text: "#4518 [NORMAL] \"Feature request: dark mode\"\u2192 product, assign:backlog", type: "output" },
      { text: "#4517 [NORMAL] \"Slow load times\"           \u2192 engineering, assign:ops", type: "output" },
      { text: "#4515 [LOW]    \"Update company address\"    \u2192 admin, assign:support", type: "dim" },
    ],
    delay: 300,
  },
  {
    command: "cliaas draft reply --ticket 4521 --tone professional",
    output: [
      { text: "\u2714 Draft generated", type: "success" },
      { text: "", type: "output" },
      { text: "\u2500\u2500\u2500 Draft Reply \u2500\u2500\u2500", type: "highlight" },
      { text: "Hi Sarah,", type: "output" },
      { text: "", type: "output" },
      { text: "I've reviewed invoice #INV-2026-0142 and can confirm the billing", type: "output" },
      { text: "discrepancy you reported. The overcharge of $47.50 was caused by", type: "output" },
      { text: "a system error that logged 2 seat additions instead of 1 when you", type: "output" },
      { text: "added a team member on February 10.", type: "output" },
      { text: "", type: "output" },
      { text: "I've issued a corrective credit of $47.50 which will appear on", type: "output" },
      { text: "your next invoice. No action needed on your end.", type: "output" },
      { text: "", type: "output" },
      { text: "I apologize for the inconvenience.", type: "output" },
      { text: "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", type: "highlight" },
      { text: "[approve] [edit] [discard]", type: "dim" },
    ],
    delay: 200,
  },
  {
    command: "cliaas kb suggest --ticket 4521 --top 3",
    output: [
      { text: "\u2714 Found 3 suggestions", type: "success" },
      { text: "", type: "output" },
      { text: "1. Understanding your invoice", type: "highlight" },
      { text: "   Relevance: 94%", type: "success" },
      { text: "   Covers prorated charges and mid-cycle seat changes", type: "dim" },
      { text: "", type: "output" },
      { text: "2. Plan comparison: Team vs Enterprise", type: "highlight" },
      { text: "   Relevance: 71%", type: "output" },
      { text: "   Details pricing structure and seat-based billing", type: "dim" },
      { text: "", type: "output" },
      { text: "3. Data export for compliance", type: "highlight" },
      { text: "   Relevance: 32%", type: "dim" },
      { text: "   May help if customer needs invoice records", type: "dim" },
    ],
    delay: 250,
  },
  {
    command: "cliaas tickets search \"password\" --limit 5",
    output: [
      { text: "Found 3 ticket matches + 2 message matches for \"password\"", type: "highlight" },
      { text: "", type: "output" },
      { text: "ID       STATUS  PRI    MATCH   SUBJECT", type: "dim" },
      { text: "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", type: "dim" },
      { text: "#4519   open    high   ticket  Can't reset password \u2014 reset email never...", type: "output" },
      { text: "#4531   pending normal ticket  Password policy update for SOC2", type: "output" },
      { text: "#4545   solved  low    ticket  How to change my password?", type: "dim" },
      { text: "#4508   open    normal msg     SSO integration with Okta failing...", type: "output" },
      { text: "  \u2514\u2500 \"...your domain acmecorp.com recently updated their password...\"", type: "dim" },
    ],
  },
  {
    command: "cliaas summarize --period today",
    output: [
      { text: "\u2714 Summary generated", type: "success" },
      { text: "", type: "output" },
      { text: "\u2022 Queue volume is moderate with 847 open tickets, down 3% from yesterday", type: "output" },
      { text: "\u2022 12 high/urgent tickets require immediate attention, led by billing", type: "error" },
      { text: "  disputes (4) and authentication issues (3)", type: "error" },
      { text: "\u2022 Average first response time today: 47 minutes (within SLA)", type: "success" },
      { text: "\u2022 Notable: recurring Okta SSO failures affecting enterprise customers", type: "highlight" },
      { text: "  \u2014 engineering team has a hotfix in progress", type: "highlight" },
      { text: "\u2022 3 VIP customers (Acme, Globex, Stark) have open escalations", type: "output" },
    ],
    delay: 300,
  },
  {
    command: "cliaas export csv --out tickets.csv",
    output: [
      { text: "\u2714 2,847 tickets exported to tickets.csv", type: "success" },
    ],
  },
  {
    command: "cliaas config show",
    output: [
      { text: "Config path: ~/.cliaas/config.json", type: "dim" },
      { text: "Active provider: claude", type: "highlight" },
      { text: "Claude API key: sk-a...Xk2f", type: "output" },
      { text: "Model: claude-sonnet-4-5-20250929", type: "output" },
    ],
  },
];

const TYPING_SPEED = 35;
const LINE_DELAY = 25;

export default function DemoPage() {
  const [lines, setLines] = useState<TermLine[]>([
    { text: "Welcome to CLIaaS \u2014 type a command or click a suggestion below.", type: "dim" },
    { text: "", type: "output" },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  const typeOutput = useCallback(async (scenario: DemoScenario) => {
    setIsTyping(true);

    // Show the command being typed
    const cmd = scenario.command;
    for (let i = 0; i <= cmd.length; i++) {
      const partial = cmd.slice(0, i);
      setLines(prev => {
        const newLines = [...prev];
        const lastIdx = newLines.length - 1;
        if (newLines[lastIdx]?.type === "command") {
          newLines[lastIdx] = { text: `$ ${partial}`, type: "command" };
        } else {
          newLines.push({ text: `$ ${partial}`, type: "command" });
        }
        return newLines;
      });
      await sleep(TYPING_SPEED);
    }

    await sleep(scenario.delay ?? 100);

    // Stream output lines
    for (const line of scenario.output) {
      setLines(prev => [...prev, line]);
      await sleep(LINE_DELAY);
    }

    setLines(prev => [...prev, { text: "", type: "output" }]);
    setIsTyping(false);
  }, []);

  const runScenario = useCallback(async (idx: number) => {
    if (isTyping) return;
    const scenario = SCENARIOS[idx % SCENARIOS.length];
    await typeOutput(scenario);
    setScenarioIndex(idx + 1);
    setInput("");
    inputRef.current?.focus();
  }, [isTyping, typeOutput]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isTyping || !input.trim()) return;

    // Find matching scenario
    const match = SCENARIOS.find(s =>
      s.command.toLowerCase().includes(input.trim().toLowerCase()) ||
      input.trim().toLowerCase().includes(s.command.split(" ").slice(0, 2).join(" ").toLowerCase())
    );

    if (match) {
      setInput("");
      await typeOutput(match);
      setScenarioIndex(prev => prev + 1);
    } else {
      setLines(prev => [
        ...prev,
        { text: `$ ${input}`, type: "command" },
        { text: `cliaas: command not found. Try: help, triage, draft, stats, export`, type: "error" },
        { text: "", type: "output" },
      ]);
      setInput("");
    }
  };

  const lineColor = (type: TermLine["type"]) => {
    switch (type) {
      case "command": return "text-emerald-400";
      case "highlight": return "text-amber-300";
      case "error": return "text-red-400";
      case "success": return "text-emerald-400";
      case "dim": return "text-zinc-500";
      default: return "text-zinc-300";
    }
  };

  const suggestions = SCENARIOS.slice(scenarioIndex, scenarioIndex + 4).map(s => s.command);
  if (suggestions.length < 4) {
    suggestions.push(...SCENARIOS.slice(0, 4 - suggestions.length).map(s => s.command));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12 text-zinc-950 sm:px-10">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="font-mono text-sm font-bold uppercase tracking-widest hover:underline">
            CLIaaS.COM
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Interactive Demo</h1>
          <p className="mt-1 text-sm font-medium text-zinc-600">
            Try CLIaaS commands in a simulated terminal. Click suggestions or type your own.
          </p>
        </div>
        <Link
          href="/"
          className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
        >
          Back
        </Link>
      </header>

      {/* Terminal */}
      <div className="mt-8 flex flex-col border-2 border-zinc-950 bg-zinc-950" style={{ height: "65vh" }}>
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500"></div>
            <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
            <div className="h-3 w-3 rounded-full bg-green-500"></div>
          </div>
          <span className="font-mono text-xs text-zinc-500">cliaas — demo</span>
          <div className="w-12"></div>
        </div>

        {/* Output */}
        <div
          ref={termRef}
          className="flex-1 overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((line, i) => (
            <div key={i} className={lineColor(line.type)}>
              {line.text || "\u00A0"}
            </div>
          ))}

          {/* Input line */}
          {!isTyping && (
            <form onSubmit={handleSubmit} className="flex items-center text-emerald-400">
              <span>$&nbsp;</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-transparent text-emerald-400 outline-none caret-emerald-400"
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </form>
          )}
        </div>
      </div>

      {/* Suggestions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="self-center font-mono text-xs font-bold uppercase text-zinc-500">Try:</span>
        {suggestions.map((cmd, i) => (
          <button
            key={`${cmd}-${i}`}
            onClick={() => runScenario(scenarioIndex + i)}
            disabled={isTyping}
            className="border-2 border-zinc-300 px-3 py-1.5 font-mono text-xs font-bold transition-colors hover:border-zinc-950 hover:bg-zinc-950 hover:text-white disabled:opacity-50"
          >
            {cmd}
          </button>
        ))}
      </div>
    </main>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
