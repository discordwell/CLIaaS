"use client";

interface CollisionReply {
  author: string;
  body: string;
  createdAt: string;
}

interface CollisionWarningModalProps {
  newReplies: CollisionReply[];
  onDiscard: () => void;
  onSendAnyway: () => void;
  onReview: () => void;
}

export default function CollisionWarningModal({
  newReplies,
  onDiscard,
  onSendAnyway,
  onReview,
}: CollisionWarningModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-zinc-950/50"
        onClick={onReview}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 w-full max-w-lg border-2 border-zinc-950 bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b-2 border-zinc-950 bg-red-50 p-6">
          <div className="flex items-center gap-3">
            <svg
              className="h-6 w-6 text-red-600"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <h3 className="text-lg font-bold text-red-900">
              Collision Detected
            </h3>
          </div>
          <p className="mt-2 font-mono text-xs text-red-700">
            {newReplies.length} new{" "}
            {newReplies.length === 1 ? "reply was" : "replies were"} added while
            you were composing your message.
          </p>
        </div>

        {/* New replies preview */}
        <div className="max-h-60 overflow-y-auto p-4">
          <div className="space-y-3">
            {newReplies.map((r, i) => (
              <div key={i} className="border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-zinc-900">
                    {r.author}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-700 line-clamp-3">
                  {r.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t-2 border-zinc-200 p-4">
          <button
            type="button"
            onClick={onDiscard}
            className="border border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold text-zinc-700 hover:bg-zinc-50"
          >
            Discard My Draft
          </button>
          <button
            type="button"
            onClick={onReview}
            className="border border-zinc-300 bg-white px-4 py-2 font-mono text-xs font-bold text-zinc-700 hover:bg-zinc-50"
          >
            Review Changes
          </button>
          <button
            type="button"
            onClick={onSendAnyway}
            className="border-2 border-red-600 bg-red-600 px-4 py-2 font-mono text-xs font-bold text-white hover:bg-red-700"
          >
            Send Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
