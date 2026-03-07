import Link from "next/link";

export default function PluginsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b-2 border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
            >
              Dashboard
            </Link>
            <span className="text-muted">/</span>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              Plugins
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/marketplace"
              className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
            >
              Marketplace
            </Link>
            <Link
              href="/dashboard/marketplace/publish"
              className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
            >
              Publish Plugin
            </Link>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
