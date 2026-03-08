// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TicketLink from "../TicketLink";
import TicketDrawerProvider from "../TicketDrawerProvider";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

describe("TicketLink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for drawer (will be called when drawer opens)
    vi.spyOn(global, "fetch").mockReturnValue(new Promise(() => {}));
  });

  it("renders a link to the ticket page", () => {
    render(
      <TicketDrawerProvider>
        <TicketLink ticketId="t-123">View Ticket</TicketLink>
      </TicketDrawerProvider>,
    );

    const link = screen.getByText("View Ticket");
    expect(link.closest("a")).toHaveAttribute("href", "/tickets/t-123");
  });

  it("opens drawer on click when viewport is desktop-width", () => {
    // Mock desktop width
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1024,
    });

    render(
      <TicketDrawerProvider>
        <TicketLink ticketId="t-123">View Ticket</TicketLink>
      </TicketDrawerProvider>,
    );

    const link = screen.getByText("View Ticket");
    fireEvent.click(link);

    // Drawer should open (dialog present)
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not open drawer when viewport is mobile-width", () => {
    // Mock mobile width
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 500,
    });

    render(
      <TicketDrawerProvider>
        <TicketLink ticketId="t-123">View Ticket</TicketLink>
      </TicketDrawerProvider>,
    );

    const link = screen.getByText("View Ticket");
    fireEvent.click(link);

    // Drawer should NOT open
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(
      <TicketDrawerProvider>
        <TicketLink ticketId="t-123" className="font-bold text-blue-600">
          Styled Link
        </TicketLink>
      </TicketDrawerProvider>,
    );

    const link = screen.getByText("Styled Link").closest("a");
    expect(link?.className).toContain("font-bold");
    expect(link?.className).toContain("text-blue-600");
  });
});
