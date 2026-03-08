// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import TicketDrawerProvider, {
  useTicketDrawer,
} from "../TicketDrawerProvider";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockTicketData = {
  ticket: {
    id: "t-123",
    externalId: "T-001",
    subject: "Cannot reset password",
    status: "open",
    priority: "high",
    source: "zendesk",
    requester: "alice@example.com",
    assignee: "Agent Bob",
    tags: ["auth", "password"],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-16T14:30:00Z",
  },
  messages: [
    {
      id: "m1",
      author: "alice@example.com",
      type: "reply",
      body: "I cannot reset my password. Help!",
      createdAt: "2026-01-15T10:00:00Z",
    },
    {
      id: "m2",
      author: "Agent Bob",
      type: "reply",
      body: "Let me look into that for you.",
      createdAt: "2026-01-15T10:05:00Z",
    },
  ],
};

/** Helper component that triggers openTicketDrawer */
function OpenButton({ ticketId }: { ticketId: string }) {
  const { openTicketDrawer } = useTicketDrawer();
  return (
    <button onClick={() => openTicketDrawer(ticketId)}>Open Drawer</button>
  );
}

describe("TicketDrawer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.style.overflow = "";
  });

  it("does not render the drawer when closed", () => {
    render(
      <TicketDrawerProvider>
        <div>App content</div>
      </TicketDrawerProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the drawer and fetches ticket data", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Cannot reset password")).toBeInTheDocument();
    });

    // "open" appears in both the status pill and the status quick-change button
    expect(screen.getAllByText("open").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("#T-001")).toBeInTheDocument();
    // Requester email also appears as message author
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
    // Agent Bob appears as assignee and message author
    expect(screen.getAllByText("Agent Bob").length).toBeGreaterThanOrEqual(1);
  });

  it("shows conversation messages", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(
        screen.getByText("I cannot reset my password. Help!"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Let me look into that for you."),
      ).toBeInTheDocument();
    });
  });

  it("shows loading skeleton while fetching", async () => {
    // Never-resolving promise to keep loading state
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    // Dialog should be open with skeleton animation
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Not found" }),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="bad-id" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to load ticket")).toBeInTheDocument();
    });
  });

  it("closes on Escape key", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    // After close animation, the drawer should slide out
    // (translate-x-full applied immediately)
    const drawer = screen.getByRole("dialog");
    expect(drawer.className).toContain("translate-x-full");
  });

  it("closes on X button click", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(screen.getByText("Cannot reset password")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Close drawer"));
    });

    const drawer = screen.getByRole("dialog");
    expect(drawer.className).toContain("translate-x-full");
  });

  it("shows tags on the ticket", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(screen.getByText("auth")).toBeInTheDocument();
      expect(screen.getByText("password")).toBeInTheDocument();
    });
  });

  it('has a "Full Page" link to the ticket detail page', async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      const fullPageLink = screen.getByText("Full Page");
      expect(fullPageLink).toBeInTheDocument();
      expect(fullPageLink.closest("a")).toHaveAttribute(
        "href",
        "/tickets/t-123",
      );
    });
  });

  it("has quick reply textarea and reply button", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Quick reply..."),
      ).toBeInTheDocument();
      expect(screen.getByText("Reply")).toBeInTheDocument();
    });
  });

  it("shows status change buttons", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    await waitFor(() => {
      // Status buttons in the footer
      expect(screen.getByText("pending")).toBeInTheDocument();
      expect(screen.getByText("solved")).toBeInTheDocument();
      expect(screen.getByText("closed")).toBeInTheDocument();
    });
  });

  it("locks body scroll when open", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTicketData),
    } as Response);

    render(
      <TicketDrawerProvider>
        <OpenButton ticketId="t-123" />
      </TicketDrawerProvider>,
    );

    expect(document.body.style.overflow).toBe("");

    await act(async () => {
      fireEvent.click(screen.getByText("Open Drawer"));
    });

    expect(document.body.style.overflow).toBe("hidden");
  });
});
