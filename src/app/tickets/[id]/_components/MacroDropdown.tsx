"use client";

import { useEffect, useState, useRef } from "react";

interface Macro {
  id: string;
  name: string;
  description?: string;
}

interface Props {
  ticketId: string;
  onApplied?: () => void;
}

export default function MacroDropdown({ ticketId, onApplied }: Props) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/macros")
      .then((r) => r.json())
      .then((d) => setMacros(d.macros ?? []))
      .catch(() => setMacros([]));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function apply(macro: Macro) {
    setApplying(macro.id);
    try {
      const res = await fetch(`/api/macros/${macro.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast(`Applied "${macro.name}" — ${data.actionsExecuted} action(s)`);
        onApplied?.();
      } else {
        setToast(`Error: ${data.error}`);
      }
    } catch {
      setToast("Failed to apply macro");
    } finally {
      setApplying(null);
      setOpen(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  if (macros.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-700 hover:border-zinc-950"
      >
        Apply Macro ▾
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 min-w-[200px] border-2 border-zinc-950 bg-white shadow-lg">
          {macros.map((m) => (
            <button
              key={m.id}
              onClick={() => apply(m)}
              disabled={applying === m.id}
              className="block w-full px-4 py-2 text-left font-mono text-xs hover:bg-zinc-100 disabled:opacity-50"
            >
              <span className="font-bold">{m.name}</span>
              {m.description && (
                <span className="ml-2 text-zinc-500">{m.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {toast && (
        <div className="absolute right-0 top-full z-20 mt-2 whitespace-nowrap border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
