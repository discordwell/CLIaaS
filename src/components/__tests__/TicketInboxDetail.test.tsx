// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import TicketInboxDetail from "../TicketInboxDetail";

const sampleTicket = {
  id: "t1",
  externalId: "1001",
  subject: "Login not working",
  source: "zendesk",
  status: "open",
  priority: "urgent",
  assignee: "Alice",
  requester: "bob@example.com",
  createdAt: "2026-03-01T10:00:00Z",
  updatedAt: "2026-03-07T12:00:00Z",
  tags: ["auth"],
};

const sampleMessages = [
  {
    id: "m1",
    author: "bob@example.com",
    type: "reply",
    body: "I cannot log into my account.",
    createdAt: "2026-03-01T10:05:00Z",
  },
  {
    id: "m2",
    author: "Alice",
    type: "reply",
    body: "Have you tried resetting your password?",
    createdAt: "2026-03-01T11:00:00Z",
  },
  {
    id: "m3",
    author: "System",
    type: "note",
    body: "Internal note: customer is VIP",
    createdAt: "2026-03-01T11:05:00Z",
  },
];

describe("TicketInboxDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton initially", () => {
    // Mock fetch to never resolve
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);
    expect(screen.getByTestId("loading-skeleton")).toBeInTheDocument();
  });

  it("renders ticket header with subject and metadata", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: sampleMessages }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    expect(screen.getByText("Login not working")).toBeInTheDocument();
    expect(screen.getByText(/#1001/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
  });

  it("renders status and priority pills", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: sampleMessages }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    // Status pills (header + status buttons row)
    const openElements = screen.getAllByText("open");
    expect(openElements.length).toBeGreaterThanOrEqual(1);

    const urgentElements = screen.getAllByText("urgent");
    expect(urgentElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders messages after loading", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: sampleMessages }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    await waitFor(() => {
      expect(
        screen.getByText("I cannot log into my account.")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Have you tried resetting your password?")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Internal note: customer is VIP")
    ).toBeInTheDocument();
  });

  it("shows note badge on internal notes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: sampleMessages }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    await waitFor(() => {
      expect(screen.getByText("Note")).toBeInTheDocument();
    });
  });

  it("shows error message when fetch fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Not found" }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load messages")).toBeInTheDocument();
    });
  });

  it("renders reply textarea and send button", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    expect(screen.getByTestId("reply-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("send-reply-btn")).toBeInTheDocument();
    expect(screen.getByTestId("send-reply-btn")).toBeDisabled();
  });

  it("enables send button when reply text is entered", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    const textarea = screen.getByTestId("reply-textarea");
    fireEvent.change(textarea, { target: { value: "Test reply" } });
    expect(screen.getByTestId("send-reply-btn")).not.toBeDisabled();
  });

  it("switches to note mode when Note toggle is clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    // The footer has a "Note" toggle and a "Reply" toggle
    const noteButtons = screen.getAllByText("Note");
    // Click the one in the toggle bar (not the message badge)
    fireEvent.click(noteButtons[0]);
    expect(screen.getByText("Add Note")).toBeInTheDocument();
    expect(
      screen.getByText("Internal note -- not visible to customer")
    ).toBeInTheDocument();
  });

  it("renders the open full page link", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    const fullPageLink = screen.getByText(/Open full page/);
    expect(fullPageLink.closest("a")).toHaveAttribute("href", "/tickets/t1");
  });

  it("renders status change buttons", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    expect(screen.getByText("Status:")).toBeInTheDocument();
    // Status buttons: open, pending, solved, closed
    const statusButtons = screen.getAllByText("pending");
    expect(statusButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("sends reply and refreshes messages on success", async () => {
    const fetchMock = vi.spyOn(global, "fetch");

    // First call: load messages; second: send reply; third: reload messages
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [
              {
                id: "m-new",
                author: "Agent",
                type: "reply",
                body: "Test reply",
                createdAt: "2026-03-07T13:00:00Z",
              },
            ],
          }),
      } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("No messages in this thread.")).toBeInTheDocument();
    });

    const textarea = screen.getByTestId("reply-textarea");
    fireEvent.change(textarea, { target: { value: "Test reply" } });
    fireEvent.click(screen.getByTestId("send-reply-btn"));

    await waitFor(() => {
      expect(screen.getByText("Reply sent")).toBeInTheDocument();
    });
  });

  it("shows empty state when no messages", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [] }),
    } as Response);

    render(<TicketInboxDetail ticketId="t1" ticket={sampleTicket} />);

    await waitFor(() => {
      expect(
        screen.getByText("No messages in this thread.")
      ).toBeInTheDocument();
    });
  });
});
