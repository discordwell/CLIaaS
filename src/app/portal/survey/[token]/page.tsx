"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type SurveyType = "csat" | "nps" | "ces";

interface SurveyMeta {
  surveyType: SurveyType;
  ticketId?: string;
}

export default function SurveyPage() {
  const params = useParams();
  const token = params.token as string;

  const [meta, setMeta] = useState<SurveyMeta | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Lookup token to determine survey type
  useEffect(() => {
    async function lookupToken() {
      let found = false;
      try {
        const res = await fetch(`/api/surveys/responses?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          const response = data.responses?.find(
            (r: { token?: string }) => r.token === token
          );
          if (response) {
            setMeta({
              surveyType: response.surveyType,
              ticketId: response.ticketId,
            });
            found = true;
            if (response.rating !== null && response.rating !== undefined) {
              setSubmitted(true);
            }
          }
        }
      } catch {
        // Token lookup failed — allow manual survey type selection via URL hash
      }

      // Fallback: determine type from URL hash (#nps, #ces, #csat) or default to nps
      if (!found) {
        const hash = window.location.hash.replace("#", "") as SurveyType;
        const validTypes: SurveyType[] = ["csat", "nps", "ces"];
        setMeta({
          surveyType: validTypes.includes(hash) ? hash : "nps",
        });
      }

      setLoading(false);
    }
    lookupToken();
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === null) {
      setError("Please select a rating.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyType: meta?.surveyType,
          rating,
          comment: comment.trim() || undefined,
          token,
          ticketId: meta?.ticketId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to submit");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading survey...</p>
        </div>
      </main>
    );
  }

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
            the time to share your experience.
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

  const surveyType = meta?.surveyType ?? "nps";

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-zinc-950">
      <div className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        {surveyType === "nps" && (
          <NPSSurvey
            rating={rating}
            hoverRating={hoverRating}
            setRating={setRating}
            setHoverRating={setHoverRating}
            ticketId={meta?.ticketId}
          />
        )}
        {surveyType === "ces" && (
          <CESSurvey
            rating={rating}
            hoverRating={hoverRating}
            setRating={setRating}
            setHoverRating={setHoverRating}
            ticketId={meta?.ticketId}
          />
        )}
        {surveyType === "csat" && (
          <CSATSurvey
            rating={rating}
            hoverRating={hoverRating}
            setRating={setRating}
            setHoverRating={setHoverRating}
            ticketId={meta?.ticketId}
          />
        )}

        <form onSubmit={onSubmit} className="mt-8">
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us more about your experience..."
              rows={3}
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
            disabled={submitting || rating === null}
            className="mt-4 w-full border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </form>
      </div>
    </main>
  );
}

// ---- NPS: 0-10 horizontal buttons ----

function NPSSurvey({
  rating,
  hoverRating,
  setRating,
  setHoverRating,
  ticketId,
}: {
  rating: number | null;
  hoverRating: number | null;
  setRating: (n: number) => void;
  setHoverRating: (n: number | null) => void;
  ticketId?: string;
}) {
  const active = hoverRating ?? rating;

  function getColor(n: number): string {
    if (active === null) return "border-zinc-300 text-zinc-400";
    if (n > active) return "border-zinc-300 text-zinc-400";
    if (active <= 6) return "border-red-500 bg-red-50 text-red-700";
    if (active <= 8) return "border-amber-500 bg-amber-50 text-amber-700";
    return "border-emerald-500 bg-emerald-50 text-emerald-700";
  }

  return (
    <>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
        Net Promoter Score
      </p>
      <h1 className="mt-4 text-2xl font-bold">
        How likely are you to recommend us?
      </h1>
      {ticketId && (
        <p className="mt-2 text-sm text-zinc-600">
          Based on your experience with ticket{" "}
          <span className="font-mono font-bold">{ticketId.slice(0, 8)}</span>.
        </p>
      )}
      <div className="mt-6">
        <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
          Rating
        </label>
        <div className="mt-3 flex gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(null)}
              onClick={() => setRating(n)}
              className={`flex h-10 w-10 items-center justify-center border-2 font-mono text-sm font-bold transition-colors ${getColor(n)}`}
              aria-label={`${n}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-xs text-zinc-400">
          <span>Not likely</span>
          <span>Very likely</span>
        </div>
      </div>
    </>
  );
}

// ---- CES: 1-7 effort scale ----

function CESSurvey({
  rating,
  hoverRating,
  setRating,
  setHoverRating,
  ticketId,
}: {
  rating: number | null;
  hoverRating: number | null;
  setRating: (n: number) => void;
  setHoverRating: (n: number | null) => void;
  ticketId?: string;
}) {
  const labels = [
    "",
    "Strongly Disagree",
    "Disagree",
    "Somewhat Disagree",
    "Neutral",
    "Somewhat Agree",
    "Agree",
    "Strongly Agree",
  ];

  const active = hoverRating ?? rating;

  return (
    <>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
        Customer Effort Score
      </p>
      <h1 className="mt-4 text-2xl font-bold">
        The company made it easy to handle my issue.
      </h1>
      {ticketId && (
        <p className="mt-2 text-sm text-zinc-600">
          Based on your experience with ticket{" "}
          <span className="font-mono font-bold">{ticketId.slice(0, 8)}</span>.
        </p>
      )}
      <div className="mt-6">
        <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
          Rating
        </label>
        <div className="mt-3 flex gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(null)}
              onClick={() => setRating(n)}
              className={`flex h-12 w-full items-center justify-center border-2 font-mono text-sm font-bold transition-colors ${
                active !== null && n <= active
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 text-zinc-400 hover:border-zinc-500"
              }`}
              aria-label={labels[n]}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-xs text-zinc-400">
          <span>Strongly Disagree</span>
          <span>Strongly Agree</span>
        </div>
        {active !== null && (
          <p className="mt-2 font-mono text-xs text-zinc-500">{labels[active]}</p>
        )}
      </div>
    </>
  );
}

// ---- CSAT: 5-star widget ----

function CSATSurvey({
  rating,
  hoverRating,
  setRating,
  setHoverRating,
  ticketId,
}: {
  rating: number | null;
  hoverRating: number | null;
  setRating: (n: number) => void;
  setHoverRating: (n: number | null) => void;
  ticketId?: string;
}) {
  const ratingLabels: Record<number, string> = {
    1: "Very Dissatisfied",
    2: "Dissatisfied",
    3: "Neutral",
    4: "Satisfied",
    5: "Very Satisfied",
  };

  const active = hoverRating ?? rating;

  return (
    <>
      <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
        Customer Satisfaction
      </p>
      <h1 className="mt-4 text-2xl font-bold">How was your experience?</h1>
      {ticketId && (
        <p className="mt-2 text-sm text-zinc-600">
          Please rate the support you received for ticket{" "}
          <span className="font-mono font-bold">{ticketId.slice(0, 8)}</span>.
        </p>
      )}
      <div className="mt-6">
        <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
          Rating
        </label>
        <div className="mt-3 flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(null)}
              onClick={() => setRating(star)}
              className="transition-transform hover:scale-110"
              aria-label={`${star} star${star !== 1 ? "s" : ""}`}
            >
              <svg
                className={`h-10 w-10 ${
                  active !== null && star <= active
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
        {active !== null && active > 0 && (
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {ratingLabels[active]}
          </p>
        )}
      </div>
    </>
  );
}
