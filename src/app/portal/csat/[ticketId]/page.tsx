"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function CSATSurveyPage() {
  const params = useParams();
  const ticketId = params.ticketId as string;

  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const ratingLabels: Record<number, string> = {
    1: "Very Dissatisfied",
    2: "Dissatisfied",
    3: "Neutral",
    4: "Satisfied",
    5: "Very Satisfied",
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError("Please select a rating.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/csat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          rating,
          comment: comment.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to submit rating");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center bg-emerald-500">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl font-bold">Thank You</h1>
          <p className="mt-3 text-sm text-zinc-600">
            Your feedback helps us improve our support. We appreciate you taking
            the time to rate your experience.
          </p>
          <Link
            href="/portal"
            className="mt-6 inline-block border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Back to Portal
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-zinc-950">
      <div className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
          Customer Satisfaction
        </p>
        <h1 className="mt-4 text-2xl font-bold">
          How was your experience?
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Please rate the support you received for ticket{" "}
          <span className="font-mono font-bold">{ticketId.slice(0, 8)}</span>.
        </p>

        <form onSubmit={onSubmit} className="mt-8">
          {/* Star rating */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Rating
            </label>
            <div className="mt-3 flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="transition-transform hover:scale-110"
                  aria-label={`${star} star${star !== 1 ? "s" : ""}`}
                >
                  <svg
                    className={`h-10 w-10 ${
                      star <= (hoverRating || rating)
                        ? "text-amber-400"
                        : "text-zinc-200"
                    }`}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                </button>
              ))}
            </div>
            {(hoverRating || rating) > 0 && (
              <p className="mt-2 font-mono text-xs text-zinc-500">
                {ratingLabels[hoverRating || rating]}
              </p>
            )}
          </div>

          {/* Comment */}
          <div className="mt-6">
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us more about your experience..."
              rows={4}
              className="mt-2 w-full border-2 border-zinc-300 p-3 text-sm focus:border-zinc-950 focus:outline-none"
            />
          </div>

          {error && (
            <p className="mt-3 font-mono text-xs font-bold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || rating === 0}
            className="mt-6 w-full border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit Feedback"}
          </button>
        </form>
      </div>
    </main>
  );
}
