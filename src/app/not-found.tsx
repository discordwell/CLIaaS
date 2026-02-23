import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full border-2 border-white p-8">
        <div className="font-mono text-6xl font-bold mb-4">404</div>
        <div className="font-mono text-xl mb-6 uppercase tracking-widest">
          Route not found
        </div>
        <div className="border-t border-white/30 pt-4 mb-8">
          <p className="font-mono text-sm text-white/60">
            The requested path does not exist in this workspace.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block font-mono text-sm uppercase tracking-wider border border-white px-6 py-3 hover:bg-white hover:text-black transition-colors"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
