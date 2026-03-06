"use client";

import { useEffect, useState, useRef } from "react";

interface CannedResponse {
  id: string;
  title: string;
  body: string;
  category?: string;
  scope: string;
  shortcut?: string;
  usageCount: number;
}

interface Props {
  ticketId: string;
  onInsert: (text: string) => void;
}

export default function CannedResponsePicker({ ticketId, onInsert }: Props) {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [inserting, setInserting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/canned-responses")
      .then((r) => r.json())
      .then((d) => setResponses(d.cannedResponses ?? []))
      .catch(() => setResponses([]));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const categories = [...new Set(responses.filter(r => r.category).map(r => r.category!))];

  const filtered = responses.filter(r => {
    if (category && r.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q);
    }
    return true;
  });

  async function insertResponse(cr: CannedResponse) {
    setInserting(cr.id);
    try {
      const res = await fetch(`/api/canned-responses/${cr.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = await res.json();
      onInsert(data.resolved ?? cr.body);
    } catch {
      onInsert(cr.body);
    } finally {
      setInserting(null);
      setOpen(false);
      setSearch("");
    }
  }

  if (responses.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-700 hover:border-zinc-950"
        title="Insert canned response"
      >
        Templates ▾
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-80 border-2 border-zinc-950 bg-white shadow-xl">
          {/* Search */}
          <div className="border-b border-zinc-200 p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Category tabs */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-zinc-200 p-2">
              <button
                type="button"
                onClick={() => setCategory(null)}
                className={`px-2 py-0.5 font-mono text-[10px] font-bold ${!category ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
              >
                ALL
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`px-2 py-0.5 font-mono text-[10px] font-bold ${category === c ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          <div className="max-h-60 overflow-y-auto">
            {filtered.length > 0 ? (
              filtered.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => insertResponse(r)}
                  disabled={inserting === r.id}
                  className="block w-full border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{r.title}</span>
                    {r.shortcut && (
                      <span className="ml-2 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        {r.shortcut}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">
                    {r.body.slice(0, 80)}...
                  </p>
                </button>
              ))
            ) : (
              <p className="p-3 text-center font-mono text-xs text-zinc-400">
                No templates found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
