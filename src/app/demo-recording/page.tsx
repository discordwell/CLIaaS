'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { scenario, type ScenarioStep } from './scenario';

/** Pixel mascot SVG — matches the one on the landing page */
function ClaudeMascot() {
  return (
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
  );
}

type RenderedLine = {
  text: string;
  className?: string;
  isUserInput?: boolean;
  isPartial?: boolean; // mid-typewriter
};

export default function DemoRecordingPage() {
  const [lines, setLines] = useState<RenderedLine[]>([]);
  const [started, setStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  // Parse query params
  const speedRef = useRef(1);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    speedRef.current = parseFloat(params.get('speed') || '1') || 1;
    if (params.get('autostart') === 'true') {
      const timer = setTimeout(() => setStarted(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const sleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms / speedRef.current);
    });
  }, []);

  const addLine = useCallback((line: RenderedLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const updateLastLine = useCallback((line: RenderedLine) => {
    setLines((prev) => [...prev.slice(0, -1), line]);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  // Run the animation
  useEffect(() => {
    if (!started) return;
    abortRef.current = false;

    async function run() {
      for (const step of scenario) {
        if (abortRef.current) return;

        switch (step.type) {
          case 'user-input': {
            // Typewriter effect for user input
            for (let i = 0; i <= step.text.length; i++) {
              if (abortRef.current) return;
              const partial = step.text.slice(0, i);
              if (i === 0) {
                addLine({ text: partial, isUserInput: true, isPartial: true });
              } else {
                updateLastLine({
                  text: partial,
                  isUserInput: true,
                  isPartial: i < step.text.length,
                });
              }
              await sleep(50);
            }
            // Brief pause after typing
            await sleep(300);
            break;
          }
          case 'response': {
            for (const line of step.lines) {
              if (abortRef.current) return;
              addLine({ text: line.text, className: line.className });
              await sleep(250);
            }
            break;
          }
          case 'pause': {
            await sleep(step.ms);
            break;
          }
        }
      }
    }

    run();
    return () => {
      abortRef.current = true;
    };
  }, [started, addLine, updateLastLine, sleep]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
      <div className="flex h-full w-full max-w-[800px] flex-col p-6 sm:p-10">
        {/* Claude Code header */}
        <div className="mb-6 flex items-start gap-3 border-b-2 border-zinc-800 pb-5">
          <ClaudeMascot />
          <div className="font-mono text-xs leading-relaxed">
            <p>
              <span className="font-bold text-zinc-200">Claude Code</span>{' '}
              <span className="text-zinc-500">v2.1.52</span>
            </p>
            <p className="text-zinc-500">Opus 4.6 · Claude Max</p>
            <p className="text-zinc-500">~/Support/Zendesk/FML</p>
          </div>
        </div>

        {/* Terminal output */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-sm leading-[1.8] text-zinc-300"
        >
          {!started && (
            <button
              onClick={() => setStarted(true)}
              className="mt-4 border-2 border-zinc-700 px-4 py-2 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              Start Demo (or add ?autostart=true)
            </button>
          )}
          {lines.map((line, i) => {
            if (line.isUserInput) {
              return (
                <div key={i} className="bg-zinc-800">
                  <span className="text-zinc-500">{'❯ '}</span>
                  <span className="text-zinc-100">{line.text}</span>
                  {line.isPartial && (
                    <span className="inline-block h-4 w-[2px] translate-y-[2px] animate-pulse bg-zinc-400" />
                  )}
                </div>
              );
            }
            return (
              <div key={i} className={line.className || 'text-zinc-300'}>
                {line.text || '\u00A0'}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
