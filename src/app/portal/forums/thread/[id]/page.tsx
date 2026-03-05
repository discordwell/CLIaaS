"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface ThreadDetail {
  id: string;
  categoryId: string;
  title: string;
  body: string;
  status: "open" | "closed" | "pinned";
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  lastActivityAt: string;
  convertedTicketId?: string;
  createdAt: string;
}

interface ReplyDetail {
  id: string;
  body: string;
  isBestAnswer: boolean;
  createdAt: string;
}

export default function PortalThreadPage() {
  const params = useParams<{ id: string }>();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [replies, setReplies] = useState<ReplyDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/forums/thread/${params.id}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setThread(data.thread);
        setReplies(data.replies ?? []);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </div>
      </main>
    );
  }

  if (notFound || !thread) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">Thread not found</p>
          <Link
            href="/portal/forums"
            className="mt-4 inline-block font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
          >
            Back to forums
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
      <header className="border-2 border-zinc-950 bg-white p-8">
        <Link
          href="/portal/forums"
          className="font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
        >
          Forums
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {thread.isPinned && (
            <span className="bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-700">
              Pinned
            </span>
          )}
          {thread.status === "closed" && (
            <span className="bg-zinc-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-600">
              Closed
            </span>
          )}
          {thread.convertedTicketId && (
            <span className="bg-blue-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-blue-700">
              Converted to Ticket
            </span>
          )}
        </div>

        <h1 className="mt-2 text-2xl font-bold">{thread.title}</h1>

        <div className="mt-3 flex items-center gap-4 font-mono text-xs text-zinc-500">
          <span>
            Posted {new Date(thread.createdAt).toLocaleDateString()}
          </span>
          <span>{thread.viewCount} views</span>
          <span>{thread.replyCount} replies</span>
        </div>
      </header>

      {/* Thread body */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
          {thread.body}
        </div>
      </section>

      {/* Replies */}
      {replies.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 font-mono text-xs font-bold uppercase text-zinc-500">
            {replies.length} Repl{replies.length !== 1 ? "ies" : "y"}
          </div>
          <div className="space-y-4">
            {replies.map((reply) => (
              <div
                key={reply.id}
                className={`border-2 bg-white p-6 ${
                  reply.isBestAnswer
                    ? "border-emerald-500"
                    : "border-zinc-950"
                }`}
              >
                {reply.isBestAnswer && (
                  <p className="mb-3 font-mono text-xs font-bold uppercase text-emerald-600">
                    Best Answer
                  </p>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                  {reply.body}
                </div>
                <p className="mt-3 font-mono text-xs text-zinc-400">
                  {new Date(reply.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="mt-8 border-2 border-zinc-950 bg-white p-6 text-center">
        <p className="text-sm text-zinc-600">
          Need direct help?{" "}
          <Link
            href="/portal/tickets/new"
            className="font-bold text-zinc-950 underline hover:no-underline"
          >
            Submit a ticket
          </Link>
        </p>
      </div>
    </main>
  );
}
