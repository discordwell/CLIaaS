"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { usePermissions } from "./rbac/PermissionProvider";

/* ── Palette item definitions ─────────────────────────────────── */

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  href: string;
  group: string;
  keywords?: string[];
  permission?: string;
  action?: "signout";
}

const ITEMS: PaletteItem[] = [
  // ── Core ──
  { id: "dashboard", label: "Dashboard", description: "Workspace overview & status", href: "/dashboard", group: "Core", keywords: ["home", "main", "overview"] },
  { id: "tickets", label: "Tickets", description: "View and manage support tickets", href: "/tickets", group: "Core", keywords: ["issues", "cases", "support"], permission: "tickets:view" },
  { id: "chat", label: "Live Chat", description: "Real-time conversations", href: "/chat", group: "Core", keywords: ["messaging", "conversations", "live"] },

  // ── Automate ──
  { id: "rules", label: "Rules", description: "Trigger-based automations", href: "/rules", group: "Automate", keywords: ["triggers", "conditions", "automation"], permission: "automation:view" },
  { id: "workflows", label: "Workflows", description: "Multi-step automation flows", href: "/workflows", group: "Automate", keywords: ["automation", "flows", "process"], permission: "automation:view" },
  { id: "bots", label: "Chatbots", description: "Bot builder & management", href: "/chatbots", group: "Automate", keywords: ["bot", "ai", "chatbot"] },
  { id: "ai", label: "AI Agent", description: "AI configuration & training", href: "/ai", group: "Automate", keywords: ["artificial", "intelligence", "copilot", "agent"] },

  // ── Engage ──
  { id: "channels", label: "Channels", description: "Email, social, voice & more", href: "/channels", group: "Engage", keywords: ["email", "social", "voice", "sms"], permission: "channels:view" },
  { id: "campaigns", label: "Campaigns", description: "Outbound messaging campaigns", href: "/campaigns", group: "Engage", keywords: ["email", "outbound", "marketing"] },
  { id: "tours", label: "Product Tours", description: "In-app guided walkthroughs", href: "/tours", group: "Engage", keywords: ["onboarding", "guide", "walkthrough"] },
  { id: "messages", label: "Messages", description: "Targeted in-app messages", href: "/messages", group: "Engage", keywords: ["banner", "popup", "notification"] },
  { id: "kb", label: "Knowledge Base", description: "Help center & articles", href: "/kb", group: "Engage", keywords: ["help", "articles", "docs", "faq"] },

  // ── Insights ──
  { id: "analytics", label: "Analytics", description: "Dashboards & performance metrics", href: "/analytics", group: "Insights", keywords: ["metrics", "graphs", "data"], permission: "analytics:view" },
  { id: "reports", label: "Reports", description: "Custom & scheduled reports", href: "/reports", group: "Insights", keywords: ["export", "csv", "schedule"] },
  { id: "sla", label: "SLA Policies", description: "Service level agreements", href: "/sla", group: "Insights", keywords: ["policy", "response", "resolution", "time"] },
  { id: "wfm", label: "Workforce", description: "Scheduling, forecasting & adherence", href: "/wfm", group: "Insights", keywords: ["workforce", "schedule", "forecast", "staffing"], permission: "admin:settings" },

  // ── Configure ──
  { id: "routing", label: "Routing", description: "Ticket assignment rules", href: "/settings/routing", group: "Configure", keywords: ["assign", "queue", "round-robin"], permission: "channels:view" },
  { id: "hours", label: "Business Hours", description: "Operating schedules & holidays", href: "/business-hours", group: "Configure", keywords: ["schedule", "timezone", "holiday"] },
  { id: "brands", label: "Brands", description: "Multi-brand configuration", href: "/brands", group: "Configure", keywords: ["brand", "multi", "white-label"] },
  { id: "integrations", label: "Integrations", description: "Third-party app connections", href: "/integrations", group: "Configure", keywords: ["connect", "api", "third-party", "zapier"] },
  { id: "marketplace", label: "Marketplace", description: "Browse & install apps", href: "/marketplace", group: "Configure", keywords: ["apps", "plugins", "extensions", "store"] },
  { id: "security", label: "Security", description: "SSO, SCIM & access controls", href: "/security", group: "Configure", keywords: ["sso", "scim", "auth", "permissions"] },
  { id: "enterprise", label: "Enterprise", description: "Enterprise-grade features", href: "/enterprise", group: "Configure", keywords: ["enterprise", "advanced", "premium"] },
  { id: "billing", label: "Billing", description: "Plans, usage & invoices", href: "/billing", group: "Configure", keywords: ["payment", "plan", "invoice", "subscription"], permission: "admin:billing" },
  { id: "docs", label: "Documentation", description: "API reference & CLI guide", href: "/docs", group: "Configure", keywords: ["api", "cli", "reference", "guide"] },

  // ── Actions ──
  { id: "signout", label: "Sign Out", description: "End your session", href: "/", group: "Actions", keywords: ["logout", "exit", "leave"], action: "signout" },
];

const GROUP_ORDER = ["Core", "Automate", "Engage", "Insights", "Configure", "Actions"];
const GROUP_ACCENTS: Record<string, string> = {
  Core: "#10b981",
  Automate: "#f59e0b",
  Engage: "#3b82f6",
  Insights: "#8b5cf6",
  Configure: "#6b7280",
  Actions: "#ef4444",
};

const RECENTS_KEY = "cliaas-cmd-recents";
const MAX_RECENTS = 5;

/* ── Fuzzy matcher ────────────────────────────────────────────── */

interface FuzzyResult {
  matches: boolean;
  score: number;
  indices: number[];
}

function fuzzyMatch(query: string, text: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { matches: true, score: 0, indices: [] };

  let qi = 0;
  const indices: number[] = [];
  let score = 0;
  let prevIndex = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (prevIndex === ti - 1) score += 15; // consecutive bonus
      if (ti === 0 || /[\s/\-_]/.test(t[ti - 1])) score += 10; // word-start bonus
      prevIndex = ti;
      qi++;
    }
  }

  if (qi !== q.length) return { matches: false, score: -1, indices: [] };
  score -= t.length * 0.1; // prefer shorter matches
  return { matches: true, score, indices };
}

function matchItem(query: string, item: PaletteItem): FuzzyResult {
  const labelResult = fuzzyMatch(query, item.label);
  if (labelResult.matches) return { ...labelResult, score: labelResult.score + 20 };

  const descResult = fuzzyMatch(query, item.description);
  if (descResult.matches) return { ...descResult, score: descResult.score + 5 };

  const hrefResult = fuzzyMatch(query, item.href);
  if (hrefResult.matches) return hrefResult;

  for (const kw of item.keywords ?? []) {
    const kwResult = fuzzyMatch(query, kw);
    if (kwResult.matches) return { ...kwResult, score: kwResult.score + 10 };
  }

  return { matches: false, score: -1, indices: [] };
}

/* ── Highlighted text renderer ────────────────────────────────── */

function HighlightedText({
  text,
  indices,
  className,
}: {
  text: string;
  indices: number[];
  className?: string;
}) {
  if (!indices.length) return <span className={className}>{text}</span>;
  const indexSet = new Set(indices);
  return (
    <span className={className}>
      {text.split("").map((char, i) =>
        indexSet.has(i) ? (
          <span key={i} style={{ color: "#34d399", fontWeight: 700 }}>
            {char}
          </span>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </span>
  );
}

/* ── Recents ──────────────────────────────────────────────────── */

function getRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const recents = getRecents().filter((r) => r !== id);
    recents.unshift(id);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch { /* localStorage unavailable */ }
}

/* ── Component ────────────────────────────────────────────────── */

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { rbacActive, hasPermission } = usePermissions();

  // Filter items by RBAC
  const permittedItems = useMemo(
    () =>
      ITEMS.filter(
        (item) => !rbacActive || !item.permission || hasPermission(item.permission),
      ),
    [rbacActive, hasPermission],
  );

  // Build filtered + scored results
  const results = useMemo(() => {
    if (!query.trim()) {
      // No query: show recents first, then all grouped
      const recents = getRecents();
      const recentItems = recents
        .map((id) => permittedItems.find((item) => item.id === id))
        .filter(Boolean) as PaletteItem[];

      const groups: { group: string; items: { item: PaletteItem; result: FuzzyResult }[] }[] = [];

      if (recentItems.length > 0) {
        groups.push({
          group: "Recent",
          items: recentItems.map((item) => ({ item, result: { matches: true, score: 100, indices: [] } })),
        });
      }

      for (const groupName of GROUP_ORDER) {
        const groupItems = permittedItems.filter((item) => item.group === groupName);
        if (groupItems.length > 0) {
          groups.push({
            group: groupName,
            items: groupItems.map((item) => ({ item, result: { matches: true, score: 0, indices: [] } })),
          });
        }
      }
      return groups;
    }

    // With query: fuzzy search all, return sorted flat then re-group
    const scored = permittedItems
      .map((item) => ({ item, result: matchItem(query, item) }))
      .filter(({ result }) => result.matches)
      .sort((a, b) => b.result.score - a.result.score);

    if (scored.length === 0) return [];

    // Group the filtered results maintaining score order within groups
    const groupMap = new Map<string, { item: PaletteItem; result: FuzzyResult }[]>();
    for (const entry of scored) {
      const g = entry.item.group;
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push(entry);
    }

    return [...groupMap.entries()]
      .sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))
      .map(([group, items]) => ({ group, items }));
  }, [query, permittedItems]);

  // Flat list of all visible items for keyboard navigation
  const flatItems = useMemo(() => results.flatMap((g) => g.items), [results]);

  // ── Keyboard handler ──────────────────────────────────────────

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      if (item.action === "signout") {
        fetch("/api/auth/signout", { method: "POST" }).finally(() => {
          router.push("/");
        });
      } else {
        router.push(item.href);
      }
      pushRecent(item.id);
      setOpen(false);
      setQuery("");
    },
    [router],
  );

  // Global ⌘K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        if (!open) {
          setQuery("");
          setActiveIndex(0);
        }
      }
    }

    function onCustomOpen() {
      setOpen(true);
      setQuery("");
      setActiveIndex(0);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onCustomOpen);
    };
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset active index on query change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector("[data-active='true']");
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatItems[activeIndex]) {
          handleSelect(flatItems[activeIndex].item);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery("");
        break;
    }
  }

  if (!open) return null;

  let itemCounter = -1;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[999]"
        style={{
          backgroundColor: "rgba(9, 9, 11, 0.6)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: "cmdFadeIn 150ms ease-out",
        }}
        onClick={() => {
          setOpen(false);
          setQuery("");
        }}
      />

      {/* Palette */}
      <div
        className="fixed inset-0 z-[1000] flex items-start justify-center"
        style={{ paddingTop: "min(20vh, 160px)" }}
        onClick={() => {
          setOpen(false);
          setQuery("");
        }}
      >
        <div
          style={{
            width: "min(640px, calc(100vw - 32px))",
            maxHeight: "min(520px, calc(100vh - 200px))",
            backgroundColor: "#0c0c0f",
            border: "2px solid #27272a",
            borderRadius: "12px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset",
            animation: "cmdSlideIn 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "16px 20px",
              borderBottom: "1px solid #27272a",
              gap: "12px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: "14px",
                fontWeight: 700,
                color: "#34d399",
                flexShrink: 0,
                letterSpacing: "0.05em",
              }}
            >
              &gt;_
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Type a command or search..."
              spellCheck={false}
              autoComplete="off"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: "14px",
                color: "#fafafa",
                letterSpacing: "0.02em",
                caretColor: "#34d399",
              }}
            />
            <kbd
              style={{
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: "11px",
                color: "#71717a",
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "4px",
                padding: "2px 6px",
                flexShrink: 0,
              }}
            >
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 0",
              scrollbarWidth: "thin",
              scrollbarColor: "#27272a transparent",
            }}
          >
            {results.length === 0 && query.trim() && (
              <div
                style={{
                  padding: "40px 20px",
                  textAlign: "center",
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                  fontSize: "13px",
                  color: "#52525b",
                }}
              >
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
            {results.map((group) => (
              <div key={group.group} style={{ marginBottom: "4px" }}>
                {/* Group header */}
                <div
                  style={{
                    padding: "8px 20px 4px",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: GROUP_ACCENTS[group.group] ?? "#71717a",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "2px",
                      backgroundColor: GROUP_ACCENTS[group.group] ?? "#71717a",
                      borderRadius: "1px",
                      flexShrink: 0,
                    }}
                  />
                  {group.group}
                </div>
                {/* Items */}
                {group.items.map(({ item, result }) => {
                  itemCounter++;
                  const isActive = itemCounter === activeIndex;
                  const isCurrent = pathname === item.href || pathname.startsWith(item.href + "/");
                  const idx = itemCounter; // capture for closure
                  return (
                    <div
                      key={`${group.group}-${item.id}`}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelect(item)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 20px",
                        gap: "12px",
                        cursor: "pointer",
                        backgroundColor: isActive ? "#18181b" : "transparent",
                        borderLeft: isActive
                          ? `2px solid ${GROUP_ACCENTS[item.group] ?? "#71717a"}`
                          : "2px solid transparent",
                        transition: "background-color 80ms ease, border-color 80ms ease",
                      }}
                    >
                      {/* Label + description */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {query && result.indices.length > 0 ? (
                            <HighlightedText
                              text={item.label}
                              indices={result.indices}
                              className=""
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "var(--font-jetbrains-mono), monospace",
                                fontSize: "13px",
                                fontWeight: 600,
                                color: isActive ? "#fafafa" : "#d4d4d8",
                              }}
                            >
                              {item.label}
                            </span>
                          )}
                          {isCurrent && (
                            <span
                              style={{
                                fontFamily: "var(--font-jetbrains-mono), monospace",
                                fontSize: "9px",
                                fontWeight: 700,
                                color: "#34d399",
                                backgroundColor: "rgba(52, 211, 153, 0.1)",
                                padding: "1px 5px",
                                borderRadius: "3px",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                              }}
                            >
                              HERE
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-space-grotesk), sans-serif",
                            fontSize: "12px",
                            color: "#52525b",
                            marginTop: "1px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.description}
                        </div>
                      </div>

                      {/* Route path */}
                      <span
                        style={{
                          fontFamily: "var(--font-jetbrains-mono), monospace",
                          fontSize: "11px",
                          color: isActive ? "#52525b" : "#3f3f46",
                          flexShrink: 0,
                        }}
                      >
                        {item.href}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              padding: "10px 20px",
              borderTop: "1px solid #27272a",
              fontFamily: "var(--font-jetbrains-mono), monospace",
              fontSize: "11px",
              color: "#52525b",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span style={{ marginLeft: "2px" }}>navigate</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Kbd>↵</Kbd>
              <span style={{ marginLeft: "2px" }}>open</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Kbd>esc</Kbd>
              <span style={{ marginLeft: "2px" }}>close</span>
            </span>
            <span
              style={{
                marginLeft: "auto",
                color: "#3f3f46",
                fontSize: "10px",
              }}
            >
              {flatItems.length} result{flatItems.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes cmdFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cmdSlideIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

/* ── Kbd helper ───────────────────────────────────────────────── */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: "10px",
        color: "#71717a",
        backgroundColor: "#18181b",
        border: "1px solid #27272a",
        borderRadius: "3px",
        padding: "1px 4px",
        lineHeight: "16px",
      }}
    >
      {children}
    </kbd>
  );
}
