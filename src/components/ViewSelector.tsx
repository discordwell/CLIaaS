"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface ViewItem {
  id: string;
  name: string;
  viewType: string;
  description?: string;
}

export default function ViewSelector() {
  const [views, setViews] = useState<ViewItem[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentViewId = searchParams.get("view");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/views")
      .then((r) => r.json())
      .then((d) => setViews(d.views ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedView = views.find((v) => v.id === currentViewId);
  const grouped = {
    system: views.filter((v) => v.viewType === "system"),
    shared: views.filter((v) => v.viewType === "shared"),
    personal: views.filter((v) => v.viewType === "personal"),
  };

  const selectView = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", id);
    // Clear other filters when switching views
    params.delete("status");
    params.delete("priority");
    params.delete("source");
    router.push(`/tickets?${params.toString()}`);
    setOpen(false);
  };

  const clearView = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    router.push(`/tickets?${params.toString()}`);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 border-2 border-zinc-950 bg-white px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
      >
        {selectedView ? selectedView.name : "All Tickets"}
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L1 3h10z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 border-2 border-zinc-950 bg-white shadow-lg">
          <button
            type="button"
            onClick={clearView}
            className={`w-full px-4 py-2 text-left font-mono text-xs font-bold hover:bg-zinc-100 ${!currentViewId ? "bg-zinc-100" : ""}`}
          >
            All Tickets
          </button>

          {grouped.system.length > 0 && (
            <>
              <div className="border-t border-zinc-200 px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                System
              </div>
              {grouped.system.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectView(v.id)}
                  className={`w-full px-4 py-2 text-left font-mono text-xs hover:bg-zinc-100 ${currentViewId === v.id ? "bg-zinc-100 font-bold" : ""}`}
                >
                  {v.name}
                </button>
              ))}
            </>
          )}

          {grouped.shared.length > 0 && (
            <>
              <div className="border-t border-zinc-200 px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Shared
              </div>
              {grouped.shared.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectView(v.id)}
                  className={`w-full px-4 py-2 text-left font-mono text-xs hover:bg-zinc-100 ${currentViewId === v.id ? "bg-zinc-100 font-bold" : ""}`}
                >
                  {v.name}
                </button>
              ))}
            </>
          )}

          {grouped.personal.length > 0 && (
            <>
              <div className="border-t border-zinc-200 px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Personal
              </div>
              {grouped.personal.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectView(v.id)}
                  className={`w-full px-4 py-2 text-left font-mono text-xs hover:bg-zinc-100 ${currentViewId === v.id ? "bg-zinc-100 font-bold" : ""}`}
                >
                  {v.name}
                </button>
              ))}
            </>
          )}

          <div className="border-t border-zinc-200">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/views/new");
              }}
              className="w-full px-4 py-2 text-left font-mono text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            >
              + New View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
