"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import TicketDrawer from "./TicketDrawer";

interface TicketDrawerContextValue {
  openTicketDrawer: (ticketId: string) => void;
  closeTicketDrawer: () => void;
  isOpen: boolean;
  activeTicketId: string | null;
}

const TicketDrawerContext = createContext<TicketDrawerContextValue>({
  openTicketDrawer: () => {},
  closeTicketDrawer: () => {},
  isOpen: false,
  activeTicketId: null,
});

export function useTicketDrawer() {
  return useContext(TicketDrawerContext);
}

export default function TicketDrawerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openTicketDrawer = useCallback((ticketId: string) => {
    setActiveTicketId(ticketId);
    setIsOpen(true);
  }, []);

  const closeTicketDrawer = useCallback(() => {
    setIsOpen(false);
    // Delay clearing the ticket ID so the slide-out animation completes
    setTimeout(() => setActiveTicketId(null), 200);
  }, []);

  return (
    <TicketDrawerContext.Provider
      value={{ openTicketDrawer, closeTicketDrawer, isOpen, activeTicketId }}
    >
      {children}
      <TicketDrawer
        ticketId={activeTicketId}
        isOpen={isOpen}
        onClose={closeTicketDrawer}
      />
    </TicketDrawerContext.Provider>
  );
}
