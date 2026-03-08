import { NextResponse } from "next/server";
import { loadTickets, loadKBArticles, loadRules } from "@/lib/data";
import { getAllConnectorStatuses } from "@/lib/connector-service";
import { listPolicies } from "@/lib/sla";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tickets, kbArticles, rules, policies, connectors] = await Promise.all([
      loadTickets(),
      loadKBArticles(),
      loadRules(),
      listPolicies(),
      Promise.resolve(getAllConnectorStatuses()),
    ]);

    const hasConnector = connectors.some((c) => c.configured || c.hasExport);
    const hasTickets = tickets.length > 0;
    const hasSLA = policies.length > 0;
    const hasRules = rules.length > 0;
    const hasKB = kbArticles.length > 0;

    // AI is configured if either ANTHROPIC_API_KEY or OPENAI_API_KEY is set
    const hasAI = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);

    // Team check: try to count users from DB, fall back to false
    let hasTeam = false;
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import("@/db");
        const schema = await import("@/db/schema");
        const rows = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .limit(2);
        hasTeam = rows.length > 1;
      } catch {
        // DB unavailable, leave as false
      }
    }

    return NextResponse.json({
      connector: hasConnector,
      tickets: hasTickets,
      sla: hasSLA,
      rules: hasRules,
      kb: hasKB,
      ai: hasAI,
      team: hasTeam,
    });
  } catch {
    // If anything fails, return all-false so the checklist still renders
    return NextResponse.json({
      connector: false,
      tickets: false,
      sla: false,
      rules: false,
      kb: false,
      ai: false,
      team: false,
    });
  }
}
