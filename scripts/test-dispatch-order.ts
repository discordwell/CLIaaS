/**
 * Phase 0 checkpoint 0.5 (JOINT-REFACTOR plan §0 line 142-143).
 *
 * Dumps per-tick sequence of PCP calls for a given TS entity. When run with
 * `DEBUG_PCP_TRACE=1` in the dev-server environment, `perCellProcess.ts`
 * populates `globalThis.__pcpTraceBuffer` with
 *   { tick, entityId, why, beforeState, afterState, navComCleared, commenceFired }
 * for every unit/foot Per_Cell_Process call. This script reads that buffer
 * after stepping N ticks and prints the sequence filtered by entity id.
 *
 * When `__pcpTraceBuffer` is empty (the env flag was not set at page load),
 * the script reports it and exits cleanly — no assertions, diagnostic-only.
 *
 * ## Intended future-tick sequence per entity per tick
 *   Commence           (pop MissionQueue if non-null)
 *   MissionClass::AI   (Timer==0 dispatch)
 *   Firing_AI          (optional: produces bullet)
 *   Movement_AI        (Start_Driver / While_Moving / Stop_Driver chains)
 *   PCP_END            (cell-arrival processing — this script's focus)
 *
 * For Phase 0, only PCP_END tracing is wired (see DEBUG_PCP_TRACE block in
 * `src/EasterEgg/engine/perCellProcess.ts`). Phase 1 may extend the buffer
 * to also capture Commence / MissionClass::AI / Firing_AI call sites.
 *
 * ## Usage
 *   SCENARIO=SCG11EA ENTITY_ID=157 START=1 END=30 \
 *     DEBUG_PCP_TRACE=1 npx playwright test scripts/test-dispatch-order.ts
 *
 *   - SCENARIO: mission ID (default SCG11EA)
 *   - ENTITY_ID: integer entity id to filter (default: -1 = show all)
 *   - START, END: tick range (default 1..30)
 *   - BASE_URL, TS_BASE_URL: server overrides (default cliaas.com)
 *
 * Note: the DEBUG_PCP_TRACE env var must reach the TS engine at page-load
 * time. For `pnpm next dev` locally, set it in the shell that launches the
 * server. When running against cliaas.com production, the flag is NOT set
 * so the buffer will be empty — script still exits cleanly with a message.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const SCENARIO = process.env.SCENARIO ?? 'SCG11EA';
const ENTITY_ID = Number(process.env.ENTITY_ID ?? -1);
const START = Number(process.env.START ?? 1);
const END = Number(process.env.END ?? 30);

interface PCPTraceEntry {
  tick: number;
  entityId: number | string;
  why: number;
  beforeState: {
    mission: string | number | null;
    missionQueue: string | number | null;
    missionTimer: number;
    cx: number;
    cy: number;
    moveTargetLX?: number;
    moveTargetLY?: number;
  };
  afterState: {
    mission: string | number | null;
    missionQueue: string | number | null;
    missionTimer: number;
    cx: number;
    cy: number;
    moveTargetLX?: number;
    moveTargetLY?: number;
  };
  navComCleared: boolean;
  commenceFired: boolean;
}

function pcpTypeName(n: number): string {
  switch (n) {
    case 0: return 'PCP_DURING';
    case 1: return 'PCP_END';
    case 2: return 'PCP_ROTATION';
    default: return `PCP_${n}`;
  }
}

test(`${SCENARIO} dispatch-order trace ticks ${START}-${END} entity=${ENTITY_ID}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();

  console.log(`\n=== ${SCENARIO} dispatch-order: ticks ${START}→${END}${ENTITY_ID >= 0 ? `, entity=${ENTITY_ID}` : ''} ===\n`);

  await page.goto(
    `${TS_BASE_URL}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => (window as any).__agentReady === true,
    { timeout: 120_000, polling: 1000 },
  );

  // Probe whether DEBUG_PCP_TRACE was active at page load.
  const traceEnabled = await page.evaluate(() => (globalThis as any).__pcpTraceEnabled === true);
  if (!traceEnabled) {
    console.log('__pcpTraceEnabled is false — DEBUG_PCP_TRACE was not set when the engine loaded.');
    console.log('Set DEBUG_PCP_TRACE=1 in the dev-server environment so perCellProcess.ts wires the buffer.');
    console.log('Phase 0 contract: exit cleanly, no assertion, no work done.\n');
    await ctx.close();
    return;
  }

  // Reset buffer before stepping so we only capture the target window.
  await page.evaluate(() => {
    const g = (globalThis as any);
    if (typeof g.__pcpTraceReset === 'function') g.__pcpTraceReset();
    else g.__pcpTraceBuffer = [];
  });

  // Step engine from 1..END (bulk to START-1, then one tick at a time).
  if (START > 1) {
    await page.evaluate((n: number) => { (window as any).__agentStep?.(n); }, START - 1);
    // Reset AGAIN after bulk step so the buffer only reflects our target range.
    await page.evaluate(() => {
      const g = (globalThis as any);
      if (typeof g.__pcpTraceReset === 'function') g.__pcpTraceReset();
      else g.__pcpTraceBuffer = [];
    });
  }
  const ticksToRun = Math.max(0, END - START + 1);
  if (ticksToRun > 0) {
    await page.evaluate((n: number) => { (window as any).__agentStep?.(n); }, ticksToRun);
  }

  // Read buffer.
  const buffer: PCPTraceEntry[] = await page.evaluate(() => {
    const g = (globalThis as any);
    return Array.isArray(g.__pcpTraceBuffer) ? g.__pcpTraceBuffer : [];
  });

  if (buffer.length === 0) {
    console.log('Trace buffer empty — no Per_Cell_Process calls recorded in this tick range.');
    console.log('This is expected for scenarios/ticks with no cell-boundary crossings.\n');
    await ctx.close();
    return;
  }

  // Filter by entity id if requested.
  const filtered = ENTITY_ID >= 0
    ? buffer.filter(e => typeof e.entityId === 'number' && e.entityId === ENTITY_ID)
    : buffer;

  // Group by tick for readable output.
  const byTick = new Map<number, PCPTraceEntry[]>();
  for (const e of filtered) {
    const list = byTick.get(e.tick) ?? [];
    list.push(e);
    byTick.set(e.tick, list);
  }

  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  for (const tick of ticks) {
    const entries = byTick.get(tick)!;
    console.log(`--- tick ${tick} (${entries.length} PCP calls) ---`);
    for (const e of entries) {
      const before = `${String(e.beforeState.mission).padEnd(12)} mq=${String(e.beforeState.missionQueue).padEnd(12)} mt=${e.beforeState.missionTimer} cell=(${e.beforeState.cx},${e.beforeState.cy})`;
      const after = `${String(e.afterState.mission).padEnd(12)} mq=${String(e.afterState.missionQueue).padEnd(12)} mt=${e.afterState.missionTimer} cell=(${e.afterState.cx},${e.afterState.cy})`;
      const flags = [
        e.navComCleared ? 'navComCleared' : '',
        e.commenceFired ? 'commenceFired' : '',
      ].filter(Boolean).join(',') || '-';
      console.log(`  ent=${e.entityId} ${pcpTypeName(e.why)}  before[${before}]  after[${after}]  flags=${flags}`);
    }
    console.log('');
  }

  console.log(`\n=== Summary: ${filtered.length} trace entries across ${ticks.length} ticks ===\n`);
  await ctx.close();
});
