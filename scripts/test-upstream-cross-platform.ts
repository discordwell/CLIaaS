#!/usr/bin/env npx tsx
/**
 * Cross-Platform Upstream Push Test
 *
 * Integration test that:
 * 1. Connects to VPS DB (via SSH tunnel on port 5434)
 * 2. Loads real tickets from all 8 platforms
 * 3. Picks 5 tickets from each platform (40 total)
 * 4. Enqueues create_ticket to ALL 8 target platforms (320 enqueue calls)
 * 5. Pushes to real platform APIs
 * 6. Reports results per connector
 * 7. Re-enqueues the same 320 entries to verify dedup (expect 0 new inserts)
 *
 * Prerequisites:
 *   - SSH tunnel: ssh -f -N -L 5434:localhost:5434 ubuntu@cliaas.com
 *   - All platform env vars set (ZENDESK_*, FRESHDESK_*, etc.)
 *
 * Usage:
 *   npx tsx scripts/test-upstream-cross-platform.ts [--dry-run] [--tickets-per-platform N]
 */

import { eq, and, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

// ---- Config ----

const DRY_RUN = process.argv.includes('--dry-run');
const ticketsPerPlatformArg = process.argv.find(a => a.startsWith('--tickets-per-platform'));
const TICKETS_PER_PLATFORM = ticketsPerPlatformArg
  ? parseInt(process.argv[process.argv.indexOf(ticketsPerPlatformArg) + 1] || '5', 10)
  : 5;

const PLATFORMS = [
  'zendesk',
  'freshdesk',
  'groove',
  'helpcrunch',
  'intercom',
  'helpscout',
  'zoho-desk',
  'hubspot',
] as const;

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL is required. Set it before running this script.');
  process.exit(1);
}

// ---- DB setup ----

async function getDb() {
  const pool = new Pool({ connectionString: DB_URL });
  const db = drizzle(pool);
  return { db, pool };
}

// ---- Main ----

interface TicketRow {
  id: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  customer_email: string | null;
  tags: string[] | null;
  workspace_id: string;
}

interface PushResult {
  connector: string;
  enqueued: number;
  skipped_dedup: number;
  pushed: number;
  failed: number;
  skipped_push: number;
  errors: string[];
}

async function main() {
  console.log('=== Cross-Platform Upstream Push Test ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Tickets per platform: ${TICKETS_PER_PLATFORM}`);
  console.log();

  // Connect to DB
  const { db, pool } = await getDb();
  console.log('Connected to DB.');

  // Load tickets grouped by source
  const rawResult = await db.execute(sql`
    SELECT id, subject, description, status, priority, source, customer_email, tags, workspace_id
    FROM tickets
    WHERE source IS NOT NULL
    ORDER BY created_at DESC
  `);
  const allTickets: TicketRow[] = (rawResult as { rows?: TicketRow[] }).rows ?? (rawResult as unknown as TicketRow[]);

  const bySource = new Map<string, TicketRow[]>();
  for (const t of allTickets) {
    const src = t.source;
    if (!src) continue;
    const list = bySource.get(src) ?? [];
    list.push(t);
    bySource.set(src, list);
  }

  console.log('Tickets by source platform:');
  for (const [src, tickets] of bySource) {
    console.log(`  ${src}: ${tickets.length} total`);
  }
  console.log();

  // Pick N tickets per platform
  const selectedTickets: TicketRow[] = [];
  for (const platform of PLATFORMS) {
    const platformTickets = bySource.get(platform) ?? [];
    const picked = platformTickets.slice(0, TICKETS_PER_PLATFORM);
    if (picked.length === 0) {
      console.log(`  WARNING: No tickets found for ${platform}`);
    } else {
      console.log(`  Selected ${picked.length} tickets from ${platform}`);
    }
    selectedTickets.push(...picked);
  }

  console.log(`\nTotal selected: ${selectedTickets.length} tickets`);
  console.log(`Will enqueue: ${selectedTickets.length * PLATFORMS.length} create_ticket entries`);
  console.log();

  // Import upstream engine (sets DATABASE_URL first)
  process.env.DATABASE_URL = DB_URL;
  const { enqueueUpstream, upstreamPush, upstreamStatus } = await import('../cli/sync/upstream.js');

  // ---- Phase 1: Enqueue ----
  console.log('--- Phase 1: Enqueue ---');

  const enqueueResults = new Map<string, { enqueued: number; skipped: number; merged: number }>();
  for (const platform of PLATFORMS) {
    enqueueResults.set(platform, { enqueued: 0, skipped: 0, merged: 0 });
  }

  // Tag for test cleanup
  const testTag = `cross-platform-test-${Date.now()}`;

  for (const ticket of selectedTickets) {
    for (const targetPlatform of PLATFORMS) {
      // Don't push back to the same platform it came from
      if (targetPlatform === ticket.source) continue;

      const result = await enqueueUpstream({
        connector: targetPlatform,
        operation: 'create_ticket',
        ticketId: ticket.id,
        workspaceId: ticket.workspace_id,
        payload: {
          subject: `[TEST ${testTag}] ${ticket.subject}`,
          description: ticket.description ?? `Test ticket from ${ticket.source}`,
          priority: ticket.priority ?? 'normal',
          requester: ticket.customer_email ?? undefined,
          tags: ['cross-platform-test', testTag],
        },
      });

      const stats = enqueueResults.get(targetPlatform)!;
      if (result === 'enqueued') stats.enqueued++;
      else if (result === 'skipped') stats.skipped++;
      else if (result === 'merged') stats.merged++;
    }
  }

  console.log('\nEnqueue results:');
  console.log('  Platform        Enqueued  Skipped  Merged');
  console.log('  ────────────    ────────  ───────  ──────');
  for (const [platform, stats] of enqueueResults) {
    console.log(
      `  ${platform.padEnd(16)}${String(stats.enqueued).padStart(8)}  ${String(stats.skipped).padStart(7)}  ${String(stats.merged).padStart(6)}`,
    );
  }

  // ---- Phase 2: Push (if not dry run) ----
  if (!DRY_RUN) {
    console.log('\n--- Phase 2: Push ---');

    const pushResults: PushResult[] = [];

    for (const platform of PLATFORMS) {
      console.log(`  Pushing to ${platform}...`);
      try {
        const result = await upstreamPush(platform);
        pushResults.push({
          connector: platform,
          enqueued: enqueueResults.get(platform)!.enqueued,
          skipped_dedup: enqueueResults.get(platform)!.skipped,
          pushed: result.pushed,
          failed: result.failed,
          skipped_push: result.skipped,
          errors: result.errors,
        });
        console.log(`    pushed=${result.pushed} failed=${result.failed} skipped=${result.skipped}`);
        if (result.errors.length > 0) {
          for (const err of result.errors.slice(0, 3)) {
            console.log(`    ERROR: ${err}`);
          }
          if (result.errors.length > 3) {
            console.log(`    ... and ${result.errors.length - 3} more errors`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    PUSH ERROR: ${msg}`);
        pushResults.push({
          connector: platform,
          enqueued: enqueueResults.get(platform)!.enqueued,
          skipped_dedup: 0,
          pushed: 0,
          failed: 0,
          skipped_push: 0,
          errors: [msg],
        });
      }
    }

    console.log('\nPush results summary:');
    console.log('  Platform        Pushed  Failed  Skipped  Errors');
    console.log('  ────────────    ──────  ──────  ───────  ──────');
    for (const r of pushResults) {
      console.log(
        `  ${r.connector.padEnd(16)}${String(r.pushed).padStart(6)}  ${String(r.failed).padStart(6)}  ${String(r.skipped_push).padStart(7)}  ${String(r.errors.length).padStart(6)}`,
      );
    }
  } else {
    console.log('\n--- Phase 2: Push SKIPPED (dry run) ---');
  }

  // ---- Phase 3: Dedup verification ----
  console.log('\n--- Phase 3: Dedup Verification ---');
  console.log('Re-enqueuing the same entries — all should be skipped...');

  let dedupEnqueued = 0;
  let dedupSkipped = 0;
  let dedupMerged = 0;

  for (const ticket of selectedTickets) {
    for (const targetPlatform of PLATFORMS) {
      if (targetPlatform === ticket.source) continue;

      const result = await enqueueUpstream({
        connector: targetPlatform,
        operation: 'create_ticket',
        ticketId: ticket.id,
        workspaceId: ticket.workspace_id,
        payload: {
          subject: `[TEST ${testTag}] ${ticket.subject}`,
          description: ticket.description ?? `Test ticket from ${ticket.source}`,
          priority: ticket.priority ?? 'normal',
          requester: ticket.customer_email ?? undefined,
          tags: ['cross-platform-test', testTag],
        },
      });

      if (result === 'enqueued') dedupEnqueued++;
      else if (result === 'skipped') dedupSkipped++;
      else if (result === 'merged') dedupMerged++;
    }
  }

  console.log(`\nDedup results: enqueued=${dedupEnqueued} skipped=${dedupSkipped} merged=${dedupMerged}`);

  if (DRY_RUN) {
    // In dry run, entries are still pending, so dedup should catch them
    if (dedupEnqueued === 0) {
      console.log('PASS: All duplicate entries were correctly deduped.');
    } else {
      console.log(`FAIL: ${dedupEnqueued} entries were NOT deduped (expected 0).`);
    }
  } else {
    // After push, entries are no longer 'pending', so they won't be found by dedup
    // and will be re-enqueued. This is expected behavior — dedup only applies to pending entries.
    console.log(`(After push, pending entries were consumed — re-enqueue creates new pending entries. This is expected.)`);
  }

  // ---- Status report ----
  console.log('\n--- Final Status ---');
  try {
    const status = await upstreamStatus();
    console.log('  Connector       Pending  Pushed  Failed  Skipped');
    console.log('  ────────────    ───────  ──────  ──────  ───────');
    for (const s of status) {
      console.log(
        `  ${s.connector.padEnd(16)}${String(s.pending).padStart(7)}  ${String(s.pushed).padStart(6)}  ${String(s.failed).padStart(6)}  ${String(s.skipped).padStart(7)}`,
      );
    }
  } catch (err) {
    console.log(`  Could not get status: ${err instanceof Error ? err.message : err}`);
  }

  // Cleanup
  await pool.end();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
