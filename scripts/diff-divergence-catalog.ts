#!/usr/bin/env tsx
/**
 * Phase 0.3: Divergence catalog diff tool — "golden" regression guard.
 *
 * Compares artifacts/divergence-catalog.json (freshly built) against
 * artifacts/divergence-catalog.baseline.json (committed golden). Exits
 * non-zero if any scenario's divergence signature changed.
 *
 * What it guards against:
 *   - New TS code change causes a scenario's first-divergence tick to move
 *     (either direction — improvement requires explicit baseline update).
 *   - A new divergence appears at a tick that was previously clean.
 *   - An existing divergent tick's RNG call counts change.
 *
 * Usage:
 *   pnpm test:parity:golden                 # compare current vs baseline
 *   UPDATE_GOLDEN=1 pnpm test:parity:golden # overwrite baseline with current
 *
 * Workflow:
 *   1. Build catalog: pnpm test:parity:catalog (runs Playwright, ~7min)
 *   2. Diff: pnpm test:parity:golden
 *   3. On intentional improvement: UPDATE_GOLDEN=1 pnpm test:parity:golden
 *      and commit the updated baseline with clear message.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const CURRENT = path.join(ROOT, 'artifacts/divergence-catalog.json');
const BASELINE = path.join(ROOT, 'artifacts/divergence-catalog.baseline.json');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

function fatal(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

if (!fs.existsSync(CURRENT)) {
  fatal(`current catalog not found at ${CURRENT}. Run: pnpm test:parity:catalog`);
}

if (UPDATE) {
  fs.copyFileSync(CURRENT, BASELINE);
  console.log(`Updated baseline: ${BASELINE}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  fatal(`baseline missing at ${BASELINE}. Bootstrap with: UPDATE_GOLDEN=1 pnpm test:parity:golden`);
}

const current = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

let failed = 0;
const scenarios = new Set<string>([...Object.keys(current.scenarios), ...Object.keys(baseline.scenarios)]);
for (const sc of scenarios) {
  const c = current.scenarios[sc];
  const b = baseline.scenarios[sc];
  if (!c) { console.error(`  [${sc}] MISSING in current catalog`); failed++; continue; }
  if (!b) { console.error(`  [${sc}] MISSING in baseline catalog`); failed++; continue; }

  const cFirst = c.first_divergence, bFirst = b.first_divergence;
  if (cFirst !== bFirst) {
    const direction = cFirst === null ? 'now matches WASM!' :
                      bFirst === null ? 'NEW DIVERGENCE introduced' :
                      cFirst > bFirst ? `advanced ${bFirst}→${cFirst} (+${cFirst - bFirst})` :
                      `REGRESSED ${bFirst}→${cFirst} (${cFirst - bFirst})`;
    console.error(`  [${sc}] first_divergence ${direction}`);
    failed++;
  }

  if (c.total_divergent_ticks !== b.total_divergent_ticks) {
    console.error(`  [${sc}] total_divergent_ticks ${b.total_divergent_ticks}→${c.total_divergent_ticks}`);
    failed++;
  }

  // Per-tick check: any tick where wasm_calls/ts_calls changed
  const byTick = new Map<number, any>();
  for (const t of b.ticks) byTick.set(t.tick, { b: t });
  for (const t of c.ticks) {
    const v = byTick.get(t.tick) ?? {};
    v.c = t;
    byTick.set(t.tick, v);
  }
  for (const [tick, { b: bt, c: ct }] of byTick) {
    if (!bt) { console.error(`  [${sc}] tick ${tick} NEW divergence (not in baseline)`); failed++; continue; }
    if (!ct) { console.error(`  [${sc}] tick ${tick} RESOLVED (not in current)`); failed++; continue; }
    if (bt.wasm_calls !== ct.wasm_calls || bt.ts_calls !== ct.ts_calls) {
      console.error(`  [${sc}] tick ${tick} calls changed: WASM ${bt.wasm_calls}→${ct.wasm_calls}, TS ${bt.ts_calls}→${ct.ts_calls}`);
      failed++;
    }
  }
}

if (failed === 0) {
  console.log(`✓ Divergence catalog matches baseline (${scenarios.size} scenarios)`);
  process.exit(0);
} else {
  console.error(`\n✗ ${failed} divergence(s) differ from baseline`);
  console.error(`  If intentional: UPDATE_GOLDEN=1 pnpm test:parity:golden`);
  console.error(`  Include justification in commit message per docs/parity/commit-protocol.md`);
  process.exit(1);
}
