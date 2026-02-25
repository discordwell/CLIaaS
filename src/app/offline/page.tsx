'use client';

// Revalidate cached data every 60 seconds
export const revalidate = 60;

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 border-2 border-zinc-700 p-6">
          <p className="font-mono text-6xl font-bold text-white">503</p>
        </div>
        <h1 className="text-2xl font-bold text-white">You&apos;re Offline</h1>
        <p className="mt-3 font-mono text-sm text-zinc-400">
          CLIaaS requires a network connection to load fresh data.
          Cached pages may still be available.
        </p>
        <div className="mt-8 border-2 border-zinc-700 p-4">
          <p className="font-mono text-xs text-zinc-500">
            $ curl -s cliaas.com/api/health
          </p>
          <p className="mt-1 font-mono text-xs text-red-400">
            curl: (7) Failed to connect
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 border-2 border-white px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-white hover:text-zinc-950"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
