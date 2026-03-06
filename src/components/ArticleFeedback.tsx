"use client";

import { useState } from "react";

interface ArticleFeedbackProps {
  articleId: string;
}

export default function ArticleFeedback({ articleId }: ArticleFeedbackProps) {
  const [submitted, setSubmitted] = useState<boolean | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const submitFeedback = async (helpful: boolean, feedbackComment?: string) => {
    setSending(true);
    try {
      await fetch(`/api/portal/kb/${articleId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          helpful,
          comment: feedbackComment || undefined,
        }),
      });
      setSubmitted(helpful);
      setShowComment(false);
    } catch {
      // Silently fail
    } finally {
      setSending(false);
    }
  };

  if (submitted !== null) {
    return (
      <div className="mt-8 border-2 border-zinc-950 bg-zinc-50 p-6 text-center">
        <p className="text-sm font-bold text-zinc-950">
          {submitted
            ? "Glad this helped!"
            : "Sorry to hear that. We'll work on improving this."}
        </p>
        <p className="mt-1 font-mono text-xs text-zinc-500">
          Thank you for your feedback.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 border-2 border-zinc-950 bg-white p-6">
      <p className="text-center text-sm font-bold text-zinc-950">
        Was this article helpful?
      </p>
      <div className="mt-4 flex justify-center gap-4">
        <button
          type="button"
          disabled={sending}
          onClick={() => submitFeedback(true)}
          className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          Yes
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={() => setShowComment(true)}
          className="border-2 border-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-zinc-950 transition-colors hover:bg-zinc-100 disabled:opacity-50"
        >
          No
        </button>
      </div>

      {showComment && (
        <div className="mt-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What were you looking for? (optional)"
            rows={3}
            className="w-full border-2 border-zinc-950 px-3 py-2 text-sm focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={() => submitFeedback(false, comment)}
              className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Submit Feedback"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowComment(false);
                setComment("");
              }}
              className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
