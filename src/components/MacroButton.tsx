"use client";

import { useState, useRef, useEffect } from "react";

interface Macro {
  id: string;
  name: string;
  description?: string;
  actions?: number;
}

interface MacroButtonProps {
  ticketId: string;
  onApply?: () => void;
}

export default function MacroButton({ ticketId, onApply }: MacroButtonProps) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch macros when dropdown opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/macros")
      .then((r) => r.json())
      .then((d) => setMacros(d.macros ?? []))
      .catch(() => setMacros([]));
  }, [open]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function applyMacro(macro: Macro) {
    setApplying(macro.id);
    try {
      const res = await fetch(`/api/macros/${macro.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast({
          text: `Applied "${macro.name}" — ${data.actionsExecuted ?? 0} action(s)`,
          isError: false,
        });
        onApply?.();
      } else {
        setToast({ text: `Error: ${data.error}`, isError: true });
      }
    } catch {
      setToast({ text: "Failed to apply macro", isError: true });
    } finally {
      setApplying(null);
      setOpen(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-700 hover:border-zinc-950"
      >
        Macros &#9662;
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-72 border-2 border-zinc-950 bg-white shadow-xl">
          {macros.length > 0 ? (
            <div className="max-h-60 overflow-y-auto">
              {macros.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => applyMacro(m)}
                  disabled={applying === m.id}
                  className="block w-full border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-50"
                >
                  <span className="font-mono text-xs font-bold">{m.name}</span>
                  {m.description && (
                    <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-1">
                      {m.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="p-3 text-center font-mono text-xs text-zinc-400">
              No macros available
            </p>
          )}
        </div>
      )}

      {toast && (
        <div
          className={`absolute left-0 top-full z-20 mt-1 whitespace-nowrap border-2 px-3 py-1.5 font-mono text-xs font-bold ${
            toast.isError
              ? "border-red-600 bg-red-50 text-red-700"
              : "border-zinc-950 bg-zinc-950 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
