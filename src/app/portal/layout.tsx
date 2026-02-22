import Link from "next/link";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <nav className="border-b-2 border-zinc-950 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/portal" className="text-lg font-bold text-zinc-950">
            CLIaaS <span className="font-mono text-xs font-bold uppercase text-zinc-500">Support Portal</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/portal/tickets"
              className="font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950"
            >
              My Tickets
            </Link>
            <Link
              href="/portal/kb"
              className="font-mono text-xs font-bold uppercase text-zinc-600 hover:text-zinc-950"
            >
              Knowledge Base
            </Link>
            <Link
              href="/portal/tickets/new"
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              New Ticket
            </Link>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
