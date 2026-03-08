"use client";

import { useEffect, useRef } from "react";

/* ── Shortcut definitions for the help overlay ───────────────── */

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  accent: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    accent: "#10b981",
    shortcuts: [
      { keys: ["G", "D"], description: "Go to Dashboard" },
      { keys: ["G", "T"], description: "Go to Tickets" },
      { keys: ["G", "C"], description: "Go to Chat" },
      { keys: ["G", "A"], description: "Go to AI Agent" },
      { keys: ["G", "R"], description: "Go to Rules" },
      { keys: ["G", "K"], description: "Go to Knowledge Base" },
      { keys: ["G", "S"], description: "Go to Settings" },
      { keys: ["G", "B"], description: "Go to Billing" },
    ],
  },
  {
    title: "Actions",
    accent: "#3b82f6",
    shortcuts: [
      { keys: ["C"], description: "Create new ticket" },
      { keys: ["/"], description: "Focus search / filter" },
      { keys: ["?"], description: "Toggle this help" },
    ],
  },
  {
    title: "Ticket List",
    accent: "#f59e0b",
    shortcuts: [
      { keys: ["J"], description: "Next ticket" },
      { keys: ["K"], description: "Previous ticket" },
      { keys: ["Enter"], description: "Open selected ticket" },
    ],
  },
  {
    title: "General",
    accent: "#8b5cf6",
    shortcuts: [
      { keys: ["Esc"], description: "Close panel / deselect" },
      { keys: ["\u2318K", "Ctrl+K"], description: "Command palette" },
    ],
  },
];

/* ── Component ────────────────────────────────────────────────── */

export default function ShortcutHelpOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998]"
        style={{
          backgroundColor: "rgba(9, 9, 11, 0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: "shortcutFadeIn 150ms ease-out",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed inset-0 z-[999] flex items-center justify-center"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(720px, calc(100vw - 48px))",
            maxHeight: "min(560px, calc(100vh - 120px))",
            backgroundColor: "#0c0c0f",
            border: "2px solid #27272a",
            borderRadius: "12px",
            boxShadow:
              "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset",
            animation: "shortcutSlideIn 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 24px",
              borderBottom: "1px solid #27272a",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#34d399",
                  letterSpacing: "0.05em",
                }}
              >
                &gt;_
              </span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#fafafa",
                }}
              >
                Keyboard Shortcuts
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: "11px",
                color: "#71717a",
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "4px",
                padding: "3px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>ESC</span>
            </button>
          </div>

          {/* Shortcut grid */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "24px",
              scrollbarWidth: "thin",
              scrollbarColor: "#27272a transparent",
            }}
          >
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                {/* Group label */}
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: group.accent,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    marginBottom: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "2px",
                      backgroundColor: group.accent,
                      borderRadius: "1px",
                      flexShrink: 0,
                    }}
                  />
                  {group.title}
                </div>

                {/* Shortcuts */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {group.shortcuts.map((shortcut, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "4px 0",
                      }}
                    >
                      {/* Description */}
                      <span
                        style={{
                          fontFamily: "var(--font-space-grotesk), sans-serif",
                          fontSize: "13px",
                          color: "#a1a1aa",
                        }}
                      >
                        {shortcut.description}
                      </span>

                      {/* Key badges */}
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, marginLeft: "12px" }}>
                        {shortcut.keys.map((key, ki) => (
                          <span key={ki} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            {ki > 0 && shortcut.keys.length === 2 && shortcut.keys[0] === "G" && (
                              <span
                                style={{
                                  fontFamily: "var(--font-jetbrains-mono), monospace",
                                  fontSize: "10px",
                                  color: "#52525b",
                                }}
                              >
                                then
                              </span>
                            )}
                            {ki > 0 && shortcut.keys.length === 2 && shortcut.keys[0] !== "G" && (
                              <span
                                style={{
                                  fontFamily: "var(--font-jetbrains-mono), monospace",
                                  fontSize: "10px",
                                  color: "#52525b",
                                }}
                              >
                                /
                              </span>
                            )}
                            <kbd
                              style={{
                                fontFamily: "var(--font-jetbrains-mono), monospace",
                                fontSize: "11px",
                                color: "#d4d4d8",
                                backgroundColor: "#18181b",
                                border: "1px solid #3f3f46",
                                borderRadius: "4px",
                                padding: "2px 8px",
                                lineHeight: "18px",
                                minWidth: "24px",
                                textAlign: "center",
                              }}
                            >
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 24px",
              borderTop: "1px solid #27272a",
              fontFamily: "var(--font-jetbrains-mono), monospace",
              fontSize: "11px",
              color: "#52525b",
              textAlign: "center",
            }}
          >
            Press <kbd
              style={{
                fontSize: "10px",
                color: "#71717a",
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "3px",
                padding: "1px 5px",
              }}
            >?</kbd> to toggle &middot; Shortcuts disabled in text fields
          </div>
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes shortcutFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes shortcutSlideIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
