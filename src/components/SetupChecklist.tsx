"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  href: string;
  actionLabel: string;
  completed: boolean;
}

const CHECKLIST_ITEMS: Omit<ChecklistItem, "completed">[] = [
  {
    id: "connector",
    label: "Connect a helpdesk",
    description: "Link Zendesk, Freshdesk, Intercom, or another platform to start pulling in tickets.",
    href: "/settings",
    actionLabel: "Configure",
  },
  {
    id: "tickets",
    label: "Import your first tickets",
    description: "Sync tickets from your helpdesk or generate demo data to explore the product.",
    href: "/settings",
    actionLabel: "Import",
  },
  {
    id: "sla",
    label: "Set up SLA policies",
    description: "Define first-response and resolution targets so nothing slips through the cracks.",
    href: "/sla",
    actionLabel: "Set up",
  },
  {
    id: "rules",
    label: "Create automation rules",
    description: "Auto-assign, tag, or escalate tickets based on conditions you define.",
    href: "/rules",
    actionLabel: "Create",
  },
  {
    id: "kb",
    label: "Add knowledge base articles",
    description: "Build a self-service library so customers can find answers on their own.",
    href: "/kb",
    actionLabel: "Add articles",
  },
  {
    id: "ai",
    label: "Configure AI",
    description: "Connect an LLM to power auto-replies, smart routing, and ticket summaries.",
    href: "/ai",
    actionLabel: "Configure",
  },
  {
    id: "team",
    label: "Invite your team",
    description: "Add agents and set roles so your team can collaborate on tickets.",
    href: "/settings/roles",
    actionLabel: "Invite",
  },
];

const DISMISS_KEY = "cliaas-setup-checklist-dismissed";

export default function SetupChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "true") {
      setDismissed(true);
      setLoading(false);
      return;
    }

    fetch("/api/onboarding/status")
      .then((res) => res.json())
      .then((data: Record<string, boolean>) => {
        setItems(
          CHECKLIST_ITEMS.map((item) => ({
            ...item,
            completed: data[item.id] ?? false,
          }))
        );
      })
      .catch(() => {
        setItems(CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })));
      })
      .finally(() => setLoading(false));
  }, []);

  function handleDismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "true");
    }
    setDismissed(true);
  }

  if (dismissed || loading) return null;

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const allComplete = completedCount === totalCount;

  if (allComplete) return null;

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section className="border-2 border-line bg-panel p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold">Get started with CLIaaS</h2>
          <p className="mt-1 font-mono text-xs text-muted">
            {completedCount} of {totalCount} completed
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full rounded bg-zinc-200">
        <div
          className="h-1.5 rounded bg-emerald-500 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Checklist */}
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
            {/* Checkbox */}
            <div className="mt-0.5 flex-shrink-0">
              {item.completed ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                  <svg
                    className="h-3 w-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-zinc-300" />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span
                  className={`text-sm font-medium ${
                    item.completed ? "text-muted line-through" : "text-foreground"
                  }`}
                >
                  {item.label}
                </span>
                {!item.completed && (
                  <Link
                    href={item.href}
                    className="font-mono text-xs font-bold uppercase text-emerald-600 hover:text-emerald-800"
                  >
                    {item.actionLabel}
                  </Link>
                )}
              </div>
              {!item.completed && (
                <p className="mt-0.5 text-xs text-muted">{item.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Dismiss */}
      <div className="mt-5 flex justify-end">
        <button
          onClick={handleDismiss}
          className="font-mono text-xs text-muted hover:text-foreground"
        >
          Dismiss checklist
        </button>
      </div>
    </section>
  );
}
