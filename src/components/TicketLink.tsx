"use client";

import { useCallback, type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import { useTicketDrawer } from "./TicketDrawerProvider";

interface TicketLinkProps {
  ticketId: string;
  children: ReactNode;
  className?: string;
}

/**
 * A ticket link that opens the slide-over drawer on desktop,
 * and navigates to the full page on mobile (< 768px).
 */
export default function TicketLink({
  ticketId,
  children,
  className,
}: TicketLinkProps) {
  const { openTicketDrawer } = useTicketDrawer();

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      // Allow ctrl/cmd+click to open in new tab
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      // On mobile, let normal navigation happen
      if (typeof window !== "undefined" && window.innerWidth < 768) return;

      e.preventDefault();
      openTicketDrawer(ticketId);
    },
    [ticketId, openTicketDrawer],
  );

  return (
    <Link
      href={`/tickets/${ticketId}`}
      onClick={handleClick}
      className={className}
    >
      {children}
    </Link>
  );
}
