'use client';

import { useRef, useEffect } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/* ── Static fallback (extracted from original landing page <pre>) ── */
function HeroDemoStatic() {
  return (
    <pre className="overflow-x-auto font-mono text-sm leading-[1.8] text-zinc-300">
{/* ── Turn 1: Install ── */}
<span className="bg-zinc-800"><span className="text-zinc-500">{"❯ "}</span><span className="text-zinc-100">hi Claude, install cliaas</span></span>{"\n"}
{"\n"}
{"  "}<span className="text-zinc-400">●</span> <span className="text-zinc-500">Explore</span>(<span className="text-zinc-400">Find CLIaaS install method</span>) <span className="text-zinc-600">Haiku 4.5</span>{"\n"}
{"  "}<span className="text-green-400">●</span> <span className="text-green-400">Done</span> <span className="text-zinc-600">(14 tool uses · 43.6k tokens · 33s)</span>{"\n"}
{"\n"}
{"  "}<span className="text-emerald-400">Bash</span>(<span className="text-zinc-400">npm install -g cliaas</span>){"\n"}
{"    "}<span className="text-zinc-500">added 1 package in 3s</span>{"\n"}
{"\n"}
{"  "}CLIaaS is installed and the MCP server is configured.{"\n"}
{"  "}Claude Code will auto-connect to all 18 MCP tools{"\n"}
{"  "}when working in this project.{"\n"}
{"\n"}
{/* ── Turn 2: Setup ── */}
<span className="bg-zinc-800"><span className="text-zinc-500">{"❯ "}</span><span className="text-zinc-100">okay now set up byoc locally</span></span>{"\n"}
{"\n"}
{"  "}<span className="text-zinc-400">●</span> <span className="text-zinc-500">Read</span>(<span className="text-zinc-400">WIZARD/claude.md</span>){"\n"}
{"  "}<span className="text-zinc-400">●</span> <span className="text-zinc-500">Bash</span>(<span className="text-zinc-400">cliaas setup init</span>){"\n"}
{"    "}<span className="text-green-400">✓</span> PostgreSQL connected (localhost:5432){"\n"}
{"    "}<span className="text-green-400">✓</span> Created database &apos;cliaas&apos;{"\n"}
{"    "}<span className="text-green-400">✓</span> Ran 42 migrations{"\n"}
{"    "}<span className="text-green-400">✓</span> LLM provider: openai (OPENAI_API_KEY set){"\n"}
{"    "}<span className="text-zinc-500">+2 lines (ctrl+e to expand)</span>{"\n"}
{"\n"}
{"  "}Your BYOC instance is ready. I followed the setup{"\n"}
{"  "}instructions in WIZARD/claude.md — database, migrations,{"\n"}
{"  "}and LLM provider are all configured.{"\n"}
{"\n"}
{/* ── Turn 3: Sync ── */}
<span className="bg-zinc-800"><span className="text-zinc-500">{"❯ "}</span><span className="text-zinc-100">cool my Zendesk API key is •••••••• download all my tickets</span></span>{"\n"}
{"\n"}
{"  "}<span className="text-zinc-400">●</span> <span className="text-zinc-500">Bash</span>(<span className="text-zinc-400">cliaas sync pull zendesk --full</span>){"\n"}
{"    "}<span className="text-green-400">✓</span> 2,847 tickets synced (4.2s){"\n"}
{"    "}<span className="text-green-400">✓</span> 11,923 messages imported{"\n"}
{"    "}<span className="text-green-400">✓</span> Next sync: incremental (cursor saved){"\n"}
{"\n"}
{"  "}All 2,847 tickets and 11,923 messages are synced. Future{"\n"}
{"  "}syncs will be incremental — cursor is saved.
    </pre>
  );
}

/* ── Main HeroDemo component ── */
export default function HeroDemo() {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pause/play video based on viewport visibility
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || reducedMotion) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [reducedMotion]);

  return (
    <section className="mt-8 border-2 border-line bg-zinc-950 overflow-hidden text-zinc-100">
      <div
        ref={containerRef}
        style={{ aspectRatio: '16 / 10' }}
      >
        {reducedMotion ? (
          <div className="p-6 sm:p-10" role="img" aria-label="Static demo of CLIaaS being installed and used via Claude Code to sync support tickets">
            {/* Claude Code header */}
            <div className="mb-6 flex items-start gap-3 border-b-2 border-zinc-800 pb-5">
              <svg viewBox="0 0 16 16" className="mt-0.5 h-8 w-8 shrink-0" aria-hidden="true">
                <rect x="5" y="0" width="2" height="2" fill="#d97706" />
                <rect x="9" y="0" width="2" height="2" fill="#d97706" />
                <rect x="5" y="2" width="6" height="2" fill="#d97706" />
                <rect x="3" y="4" width="10" height="6" fill="#d97706" />
                <rect x="5" y="5" width="2" height="2" fill="#1e1e1e" />
                <rect x="9" y="5" width="2" height="2" fill="#1e1e1e" />
                <rect x="6" y="8" width="4" height="1" fill="#b45309" />
                <rect x="3" y="10" width="10" height="1" fill="#b45309" />
                <rect x="3" y="11" width="10" height="3" fill="#d97706" />
                <rect x="3" y="14" width="4" height="2" fill="#92400e" />
                <rect x="9" y="14" width="4" height="2" fill="#92400e" />
              </svg>
              <div className="font-mono text-xs leading-relaxed">
                <p><span className="font-bold text-zinc-200">Claude Code</span> <span className="text-zinc-500">v2.1.52</span></p>
                <p className="text-zinc-500">Opus 4.6 · Claude Max</p>
                <p className="text-zinc-500">~/Support/Zendesk/FML</p>
              </div>
            </div>
            <HeroDemoStatic />
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            poster="/demo/hero-demo-poster.png"
            aria-label="Animated demo of CLIaaS being installed and used via Claude Code to triage support tickets"
            className="h-full w-full object-cover"
          >
            <source src="/demo/hero-demo.webm" type="video/webm" />
            <source src="/demo/hero-demo.mp4" type="video/mp4" />
            <p className="p-6 text-zinc-500 font-mono text-sm">Demo video could not be loaded.</p>
          </video>
        )}
      </div>
    </section>
  );
}
