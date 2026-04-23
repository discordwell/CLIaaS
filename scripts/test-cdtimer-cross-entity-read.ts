/**
 * Phase 0 checkpoint 0.5 (JOINT-REFACTOR plan §0 line 144).
 *
 * Diagnostic: logs every cross-entity `other.attackCooldown` / `other.missionTimer`
 * read that occurs inside `cellBasedGuardScan` (missionAI.ts:1016+).
 *
 * ## Why this matters
 *
 * C++ `Evaluate_Object` at techno.cpp:1476-1510 checks the candidate target's
 * `Mission` + `Assignable` flags and — critically — does NOT read any cooldown
 * or timer state from the candidate. Several TS divergences have been traced
 * to the TS scanner reading `other.attackCooldown` or `other.missionTimer`
 * (cross-entity CDTimer reads) as a scoring signal, which C++ does not do.
 *
 * Once Phase 1 introduces the trace buffer population in `cellBasedGuardScan`
 * — pushing `{tick, scannerId, scannerHouse, candidateId, candidateHouse,
 *   attackCooldownRead, missionTimerRead}` into
 *   `globalThis.__cdtimerCrossReadBuffer`
 * — this script reads the buffer post-step and prints the per-tick histogram
 * of reads. For scenarios where the buffer remains empty (env flag unset OR
 * the scanner is not reading those fields for this tick range), the script
 * exits cleanly with a message.
 *
 * ## Phase 0 contract (this commit)
 *
 * The buffer is NOT yet populated by `cellBasedGuardScan`. This script is the
 * consumer-side scaffolding so that when a future commit wires the producer,
 * the diagnostic is ready to use. Running this script today against any
 * scenario prints "buffer empty — no cross-entity reads recorded" and exits 0.
 * That is the correct Phase 0 outcome (zero behavior change).
 *
 * ## Usage
 *   SCENARIO=SCG11EA START=1 END=30 \
 *     DEBUG_CDTIMER_CROSS_READ=1 npx playwright test scripts/test-cdtimer-cross-entity-read.ts
 *
 *   - SCENARIO: mission ID (default SCG11EA)
 *   - START, END: tick range (default 1..30)
 *   - BASE_URL, TS_BASE_URL: server overrides (default cliaas.com)
 *
 * Note: DEBUG_CDTIMER_CROSS_READ must be set in the dev-server process env at
 * page-load time so `cellBasedGuardScan` (Phase 1+) wires the push calls.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const SCENARIO = process.env.SCENARIO ?? 'SCG11EA';
const START = Number(process.env.START ?? 1);
const END = Number(process.env.END ?? 30);

interface CDTimerCrossReadEntry {
  tick: number;
  scannerId: number | string;
  scannerHouse: string | number;
  candidateId: number | string;
  candidateHouse: string | number;
  /** Which field was read. `'attackCooldown'` or `'missionTimer'`. */
  field: string;
  /** Value observed at read time. */
  value: number;
  /** True when this read participated in the target-selection decision. */
  scoredForSelection?: boolean;
}

test(`${SCENARIO} cdtimer cross-entity reads ticks ${START}-${END}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();

  console.log(`\n=== ${SCENARIO} CDTimer cross-entity reads: ticks ${START}→${END} ===\n`);

  await page.goto(
    `${TS_BASE_URL}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => (window as any).__agentReady === true,
    { timeout: 120_000, polling: 1000 },
  );

  // Probe whether the producer-side env flag was active at page load.
  const traceEnabled = await page.evaluate(() => (globalThis as any).__cdtimerCrossReadEnabled === true);
  if (!traceEnabled) {
    console.log('__cdtimerCrossReadEnabled is false — DEBUG_CDTIMER_CROSS_READ was not set when the engine loaded,');
    console.log('OR the producer (cellBasedGuardScan) has not been wired yet (Phase 0 scaffolding only).');
    console.log('Phase 0 contract: exit cleanly, no assertion, no work done.\n');
    await ctx.close();
    return;
  }

  // Reset buffer before stepping.
  await page.evaluate(() => {
    const g = (globalThis as any);
    if (typeof g.__cdtimerCrossReadReset === 'function') g.__cdtimerCrossReadReset();
    else g.__cdtimerCrossReadBuffer = [];
  });

  // Bulk-step to START-1, reset again so only the target window is captured.
  if (START > 1) {
    await page.evaluate((n: number) => { (window as any).__agentStep?.(n); }, START - 1);
    await page.evaluate(() => {
      const g = (globalThis as any);
      if (typeof g.__cdtimerCrossReadReset === 'function') g.__cdtimerCrossReadReset();
      else g.__cdtimerCrossReadBuffer = [];
    });
  }

  const ticksToRun = Math.max(0, END - START + 1);
  if (ticksToRun > 0) {
    await page.evaluate((n: number) => { (window as any).__agentStep?.(n); }, ticksToRun);
  }

  const buffer: CDTimerCrossReadEntry[] = await page.evaluate(() => {
    const g = (globalThis as any);
    return Array.isArray(g.__cdtimerCrossReadBuffer) ? g.__cdtimerCrossReadBuffer : [];
  });

  if (buffer.length === 0) {
    console.log('Trace buffer empty — no cross-entity reads recorded in this tick range.');
    console.log('Expected when the producer is not yet wired (Phase 0 scaffolding) or when');
    console.log('cellBasedGuardScan genuinely did not read other.attackCooldown / .missionTimer.\n');
    await ctx.close();
    return;
  }

  // Per-tick histogram.
  const byTick = new Map<number, CDTimerCrossReadEntry[]>();
  for (const e of buffer) {
    const list = byTick.get(e.tick) ?? [];
    list.push(e);
    byTick.set(e.tick, list);
  }

  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  let totalReads = 0;
  let totalScored = 0;
  for (const tick of ticks) {
    const entries = byTick.get(tick)!;
    totalReads += entries.length;
    const scored = entries.filter(e => e.scoredForSelection === true).length;
    totalScored += scored;
    console.log(`--- tick ${tick}: ${entries.length} cross-entity reads (${scored} scored) ---`);
    for (const e of entries) {
      const flag = e.scoredForSelection === true ? ' [SCORED]' : '';
      console.log(`  scanner=${e.scannerId}(${e.scannerHouse}) → candidate=${e.candidateId}(${e.candidateHouse}) ${e.field}=${e.value}${flag}`);
    }
    console.log('');
  }

  console.log(`\n=== Summary: ${totalReads} cross-entity reads across ${ticks.length} ticks (${totalScored} scored) ===`);
  console.log('Expected C++ parity: ZERO scored reads (C++ Evaluate_Object does not read cooldown/timer).\n');
  await ctx.close();
});
