import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadTickets } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let tickets = loadTickets();

  // Filters
  const status = searchParams.get("status");
  if (status) tickets = tickets.filter((t) => t.status === status);

  const priority = searchParams.get("priority");
  if (priority) tickets = tickets.filter((t) => t.priority === priority);

  const assignee = searchParams.get("assignee");
  if (assignee) tickets = tickets.filter((t) => t.assignee === assignee);

  const search = searchParams.get("q");
  if (search) {
    const q = search.toLowerCase();
    tickets = tickets.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.requester.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  // Sort
  const sort = searchParams.get("sort") ?? "created";
  if (sort === "priority") {
    const order = { urgent: 0, high: 1, normal: 2, low: 3 };
    tickets.sort(
      (a, b) =>
        (order[a.priority as keyof typeof order] ?? 9) -
        (order[b.priority as keyof typeof order] ?? 9)
    );
  } else if (sort === "updated") {
    tickets.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } else {
    tickets.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Pagination
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const total = tickets.length;
  tickets = tickets.slice(offset, offset + limit);

  return NextResponse.json({ tickets, total, limit, offset });
}
