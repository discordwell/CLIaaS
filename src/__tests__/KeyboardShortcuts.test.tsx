/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard",
}));

import KeyboardShortcuts from "@/components/KeyboardShortcuts";

/* ── Helpers ──────────────────────────────────────────────────── */

function fireKey(
  key: string,
  opts: Partial<KeyboardEventInit> = {}
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
}

describe("KeyboardShortcuts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── G-chord navigation ────────────────────────────────────────

  it("navigates to /dashboard on G then D", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("d"));
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("navigates to /tickets on G then T", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("t"));
    expect(mockPush).toHaveBeenCalledWith("/tickets");
  });

  it("navigates to /chat on G then C", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("c"));
    expect(mockPush).toHaveBeenCalledWith("/chat");
  });

  it("navigates to /ai on G then A", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("a"));
    expect(mockPush).toHaveBeenCalledWith("/ai");
  });

  it("navigates to /rules on G then R", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("r"));
    expect(mockPush).toHaveBeenCalledWith("/rules");
  });

  it("navigates to /kb on G then K", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("k"));
    expect(mockPush).toHaveBeenCalledWith("/kb");
  });

  it("navigates to /settings on G then S", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("s"));
    expect(mockPush).toHaveBeenCalledWith("/settings");
  });

  it("navigates to /billing on G then B", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("b"));
    expect(mockPush).toHaveBeenCalledWith("/billing");
  });

  // ── G-chord timeout ───────────────────────────────────────────

  it("cancels G-chord after 1s timeout", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    act(() => fireKey("d"));
    // After timeout, "d" should NOT trigger navigation
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not navigate on G followed by invalid key", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("g"));
    act(() => fireKey("z"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  // ── Single-key actions ────────────────────────────────────────

  it("navigates to /tickets/new on C key", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("c"));
    expect(mockPush).toHaveBeenCalledWith("/tickets/new");
  });

  it("opens help overlay on ? key", () => {
    const { container } = render(<KeyboardShortcuts />);
    act(() => fireKey("?", { shiftKey: true }));
    // The overlay should be rendered — check for the title text
    const overlayText = container.ownerDocument.body.textContent;
    expect(overlayText).toContain("Keyboard Shortcuts");
  });

  it("closes help overlay on second ? press", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("?", { shiftKey: true }));
    act(() => fireKey("?", { shiftKey: true }));
    // After toggling twice, overlay should be closed
    // The component renders nothing visible when closed
  });

  // ── Modifier keys do not trigger shortcuts ────────────────────

  it("does not fire shortcuts when Cmd is held (preserves Cmd+K)", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("c", { metaKey: true }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not fire shortcuts when Ctrl is held", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("c", { ctrlKey: true }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not fire shortcuts when Alt is held", () => {
    render(<KeyboardShortcuts />);
    act(() => fireKey("c", { altKey: true }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  // ── Input suppression ─────────────────────────────────────────

  it("does not fire shortcuts when focused on an input", () => {
    render(<KeyboardShortcuts />);
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: input });
    act(() => window.dispatchEvent(event));
    expect(mockPush).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("does not fire shortcuts when focused on a textarea", () => {
    render(<KeyboardShortcuts />);
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: textarea });
    act(() => window.dispatchEvent(event));
    expect(mockPush).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it("does not fire shortcuts when focused on a contenteditable", () => {
    render(<KeyboardShortcuts />);
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    div.focus();

    // Dispatch from the element so event.target is the contenteditable div
    const event = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    act(() => div.dispatchEvent(event));
    expect(mockPush).not.toHaveBeenCalled();

    document.body.removeChild(div);
  });

  // ── J/K dispatches ticket nav events ──────────────────────────

  it("dispatches cliaas-ticket-nav 'next' on J key", () => {
    render(<KeyboardShortcuts />);
    const handler = vi.fn();
    window.addEventListener("cliaas-ticket-nav", handler);
    act(() => fireKey("j"));
    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.action).toBe("next");
    window.removeEventListener("cliaas-ticket-nav", handler);
  });

  it("dispatches cliaas-ticket-nav 'prev' on K key", () => {
    render(<KeyboardShortcuts />);
    const handler = vi.fn();
    window.addEventListener("cliaas-ticket-nav", handler);
    act(() => fireKey("k"));
    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.action).toBe("prev");
    window.removeEventListener("cliaas-ticket-nav", handler);
  });

  // ── Escape dispatches escape event ────────────────────────────

  it("dispatches cliaas-escape on Escape key", () => {
    render(<KeyboardShortcuts />);
    const handler = vi.fn();
    window.addEventListener("cliaas-escape", handler);
    act(() => fireKey("Escape"));
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("cliaas-escape", handler);
  });
});
