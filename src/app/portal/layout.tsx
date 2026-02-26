import Link from "next/link";
import { cookies } from "next/headers";
import { verify, PORTAL_COOKIE_NAME } from "@/lib/portal/cookie";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PORTAL_COOKIE_NAME)?.value;
  const email = raw ? verify(raw) : null;

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
            {email ? (
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-zinc-500" title={email}>
                  {email.length > 20 ? email.slice(0, 18) + "…" : email}
                </span>
                <form action="/api/portal/auth/signout" method="POST">
                  <button
                    type="submit"
                    className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
                  >
                    Sign Out
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/portal"
                className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
