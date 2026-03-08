// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub window.matchMedia for jsdom
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

// Mock next/navigation
const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    refresh: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
}));

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

import TicketInbox from "../TicketInbox";

const sampleTickets = [
  {
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
    tags: ["auth", "login"],
  },
  {
    id: "t2",
    externalId: "1002",
    subject: "Billing question",
    source: "freshdesk",
    status: "pending",
    priority: "normal",
    requester: "carol@example.com",
    createdAt: "2026-03-02T10:00:00Z",
    updatedAt: "2026-03-06T15:00:00Z",
    tags: ["billing"],
  },
  {
    id: "t3",
    externalId: "1003",
    subject: "Feature request: dark mode",
    source: "zendesk",
    status: "solved",
    priority: "low",
    assignee: "Dave",
    requester: "eve@example.com",
    createdAt: "2026-03-03T10:00:00Z",
    updatedAt: "2026-03-05T09:00:00Z",
    tags: ["feature-request"],
    mergedIntoTicketId: "t99",
  },
];

const sampleStats = {
  total: 3,
  byStatus: { open: 1, pending: 1, solved: 1, closed: 0 },
  byPriority: { urgent: 1, high: 0, normal: 1, low: 1 },
};

describe("TicketInbox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearchParams = new URLSearchParams();
    mockReplace.mockClear();
    mockPush.mockClear();
    // Default to desktop width
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
  });

  it("renders the ticket count header", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText(/Tickets \(3\)/i)).toBeInTheDocument();
  });

  it("renders all ticket subjects", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("Login not working")).toBeInTheDocument();
    expect(screen.getByText("Billing question")).toBeInTheDocument();
    expect(screen.getByText("Feature request: dark mode")).toBeInTheDocument();
  });

  it("renders status filter pills with counts", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("open (1)")).toBeInTheDocument();
    expect(screen.getByText("pending (1)")).toBeInTheDocument();
    expect(screen.getByText("solved (1)")).toBeInTheDocument();
    expect(screen.getByText("closed (0)")).toBeInTheDocument();
  });

  it("renders priority filter pills with counts", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("urgent (1)")).toBeInTheDocument();
    expect(screen.getByText("normal (1)")).toBeInTheDocument();
    expect(screen.getByText("low (1)")).toBeInTheDocument();
  });

  it("shows placeholder when no ticket is selected", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("Select a ticket to view")).toBeInTheDocument();
  });

  it("filters tickets when status pill is clicked", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    fireEvent.click(screen.getByText("open (1)"));

    // After filtering, only the open ticket should be visible
    expect(screen.getByText("Login not working")).toBeInTheDocument();
    expect(screen.queryByText("Billing question")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Feature request: dark mode")
    ).not.toBeInTheDocument();
  });

  it("filters tickets when priority pill is clicked", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    fireEvent.click(screen.getByText("urgent (1)"));

    expect(screen.getByText("Login not working")).toBeInTheDocument();
    expect(screen.queryByText("Billing question")).not.toBeInTheDocument();
  });

  it("clears filter when same pill is clicked again", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);

    // Click to filter
    fireEvent.click(screen.getByText("open (1)"));
    expect(screen.queryByText("Billing question")).not.toBeInTheDocument();

    // Click again to clear
    fireEvent.click(screen.getByText("open (1)"));
    expect(screen.getByText("Billing question")).toBeInTheDocument();
  });

  it("shows merged badge on merged tickets", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("merged")).toBeInTheDocument();
  });

  it("updates URL when a ticket row is clicked on desktop", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    fireEvent.click(screen.getByTestId("ticket-row-t1"));
    expect(mockReplace).toHaveBeenCalledWith("/tickets?id=t1", {
      scroll: false,
    });
  });

  it("navigates to full page on mobile when ticket is clicked", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 500,
    });
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    fireEvent.click(screen.getByTestId("ticket-row-t1"));
    expect(mockPush).toHaveBeenCalledWith("/tickets/t1");
  });

  it("shows empty state when no tickets match filters", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    fireEvent.click(screen.getByText("closed (0)"));
    expect(
      screen.getByText("No tickets match the current filters.")
    ).toBeInTheDocument();
  });

  it("renders the Dashboard link", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    const link = screen.getByText("Dashboard");
    expect(link.closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("renders assignee or 'unassigned' for each ticket", () => {
    render(<TicketInbox tickets={sampleTickets} stats={sampleStats} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("unassigned")).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
  });
});
