'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full border-2 border-red-500 p-8">
        <div className="font-mono text-6xl font-bold mb-4 text-red-500">ERR</div>
        <div className="font-mono text-xl mb-6 uppercase tracking-widest">
          Something broke
        </div>
        <div className="border-t border-white/30 pt-4 mb-8">
          <p className="font-mono text-sm text-white/60">
            {error.message || 'An unexpected error occurred.'}
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-white/40 mt-2">
              Digest: {error.digest}
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="inline-block font-mono text-sm uppercase tracking-wider border border-white px-6 py-3 hover:bg-white hover:text-black transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
