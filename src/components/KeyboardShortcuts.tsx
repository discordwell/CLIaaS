"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import ShortcutHelpOverlay from "./ShortcutHelpOverlay";

/* ── G-chord navigation map ──────────────────────────────────── */

const NAV_CHORDS: Record<string, string> = {
  d: "/dashboard",
  t: "/tickets",
  c: "/chat",
  a: "/ai",
  r: "/rules",
  k: "/kb",
  s: "/settings",
  b: "/billing",
};

/* ── Helpers ──────────────────────────────────────────────────── */

/** Returns true when focus is inside an editable element and shortcuts should be suppressed. */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const inputType = (el as HTMLInputElement).type;
    // Allow shortcuts when focused on checkbox/radio (they're not text inputs)
    if (inputType === "checkbox" || inputType === "radio") return false;
    return true;
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable || el.contentEditable === "true") return true;
  // Role-based editable (some rich text editors use role="textbox")
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

/* ── Ticket list keyboard navigation (J/K/Enter) ─────────────── */

/**
 * Custom event dispatched by KeyboardShortcuts so the ticket list can react.
 * Detail: { action: "next" | "prev" | "open" }
 */
export type TicketNavAction = "next" | "prev" | "open";

export function dispatchTicketNav(action: TicketNavAction) {
  window.dispatchEvent(
    new CustomEvent("cliaas-ticket-nav", { detail: { action } })
  );
}

/* ── Component ────────────────────────────────────────────────── */

export default function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  // G-chord state: true when "G" was pressed and we're awaiting the second key
  const chordActiveRef = useRef(false);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    chordActiveRef.current = false;
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
  }, []);

  // Close help on route change
  useEffect(() => {
    setHelpOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never interfere with modifier combos (Cmd+K, Ctrl+C, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // If the shortcut help overlay is open, only let Escape and ? through
      if (helpOpen) {
        if (e.key === "?") {
          e.preventDefault();
          setHelpOpen(false);
        }
        // Escape is handled by ShortcutHelpOverlay itself
        return;
      }

      // Skip when typing in editable fields
      if (isEditableTarget(e)) return;

      const key = e.key.toLowerCase();

      // ── G-chord: second key ──────────────────────────────────
      if (chordActiveRef.current) {
        clearChord();
        const dest = NAV_CHORDS[key];
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }

      // ── G-chord: first key ───────────────────────────────────
      if (key === "g" && !e.shiftKey) {
        e.preventDefault();
        chordActiveRef.current = true;
        chordTimerRef.current = setTimeout(() => {
          chordActiveRef.current = false;
        }, 1000);
        return;
      }

      // ── Single-key actions ───────────────────────────────────

      // ? — show shortcut help (requires Shift, since ? = Shift+/)
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((prev) => !prev);
        return;
      }

      // / — focus search (on tickets page, focus the filter input)
      if (e.key === "/") {
        e.preventDefault();
        // Try to focus a search/filter input on the page
        const searchInput =
          document.querySelector<HTMLInputElement>('input[type="search"]') ??
          document.querySelector<HTMLInputElement>('input[placeholder*="earch"]') ??
          document.querySelector<HTMLInputElement>('input[placeholder*="ilter"]') ??
          document.querySelector<HTMLInputElement>('input[data-search]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // C — create new ticket
      if (key === "c" && !e.shiftKey) {
        e.preventDefault();
        router.push("/tickets/new");
        return;
      }

      // J — next ticket in list
      if (key === "j" && !e.shiftKey) {
        e.preventDefault();
        dispatchTicketNav("next");
        return;
      }

      // K — previous ticket in list
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        dispatchTicketNav("prev");
        return;
      }

      // Enter — open selected ticket
      if (e.key === "Enter") {
        // Only fire when we're on a list page — don't hijack Enter globally
        if (pathname === "/tickets" || pathname.startsWith("/tickets?")) {
          e.preventDefault();
          dispatchTicketNav("open");
        }
        return;
      }

      // Escape — close panels, deselect
      if (e.key === "Escape") {
        // Dispatched as a custom event so any open panel can react
        window.dispatchEvent(new CustomEvent("cliaas-escape"));
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearChord();
    };
  }, [router, pathname, helpOpen, clearChord]);

  return (
    <ShortcutHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
  );
}
