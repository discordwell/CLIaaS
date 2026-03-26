/**
 * Gameplay Comparison: TS engine vs C++ WASM original.
 *
 * Runs Allied Mission 1 (SCG01EA) on both engines with NO player input,
 * advancing by identical tick intervals via __agentStep(). Captures screenshots
 * and game state JSON at each checkpoint for side-by-side comparison.
 *
 * Run: npx playwright test scripts/test-gameplay-compare.ts
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3001';
const OUT_DIR = path.join(process.cwd(), 'test-results', 'gameplay-compare');

// Tick checkpoints — passive observation, no commands
const CHECKPOINTS = [0, 75, 150, 300, 450, 750, 1500];

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

function saveDataUrl(dataUrl: string, filePath: string): boolean {
  if (!dataUrl?.startsWith('data:image/png;base64,')) return false;
  fs.writeFileSync(filePath, Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64'));
  return true;
}

function saveJson(data: unknown, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Capture canvas as PNG data URL */
async function captureCanvas(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c?.toDataURL('image/png') ?? null;
    });
  } catch { return null; }
}

/** Extract a state summary for comparison (common fields between TS and WASM) */
function summarizeState(state: Record<string, unknown>): Record<string, unknown> {
  const units = (state.units ?? []) as Array<{ t: string; h: string; hp: number; m: string }>;
  const enemies = (state.enemies ?? []) as Array<{ t: string; h: string; hp: number; m: string }>;
  const structures = (state.structures ?? []) as Array<{ t: string; h: string; hp: number }>;

  // Count units by type
  const unitCounts: Record<string, number> = {};
  for (const u of units) unitCounts[u.t] = (unitCounts[u.t] ?? 0) + 1;

  const enemyCounts: Record<string, number> = {};
  for (const e of enemies) enemyCounts[e.t] = (enemyCounts[e.t] ?? 0) + 1;

  const structCounts: Record<string, number> = {};
  for (const s of structures) structCounts[s.t] = (structCounts[s.t] ?? 0) + 1;

  return {
    tick: state.tick,
    state: state.state,
    credits: state.credits,
    playerHouse: state.playerHouse,
    unitCount: units.length,
    enemyCount: enemies.length,
    structureCount: structures.length,
    unitsByType: unitCounts,
    enemiesByType: enemyCounts,
    structuresByType: structCounts,
    power: state.power,
    killCount: state.killCount,
    lossCount: state.lossCount,
  };
}

/**
 * Step WASM engine N ticks using the proven WasmAdapter pattern.
 *
 * PREREQUISITE: Game loop must be running (emscripten_sleep yielding each frame).
 * Uses page.evaluate(async ...) which works once the game loop is active.
 * Chunks into 15-tick steps (matching WasmAdapter.MAX_AGENT_STEP_TICKS).
 */
async function wasmStep(page: Page, n: number): Promise<{ state: Record<string, unknown> } | null> {
  const MAX_PER_CALL = 15; // Match WasmAdapter — small chunks for Asyncify stability
  let remaining = n;
  let lastResult: { state: Record<string, unknown> } | null = null;

  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_PER_CALL);
    remaining -= chunk;

    try {
      const raw = await page.evaluate(async (ticks: number) => {
        const w = window as unknown as {
          __agentStep: (n: number) => Promise<unknown> | unknown;
        };
        const r = w.__agentStep(ticks);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          return await (r as Promise<unknown>);
        }
        return r;
      }, chunk);

      if (raw && typeof raw === 'object' && 'state' in (raw as Record<string, unknown>)) {
        lastResult = raw as { state: Record<string, unknown> };
      }
    } catch (e) {
      console.log(`WASM: Step chunk failed: ${e}`);
      return lastResult;
    }
  }

  return lastResult;
}

// ──────────────────────────────────────────────────────────────

test.describe('Gameplay Comparison: SCG01EA (Allied M1)', () => {
  test.setTimeout(10 * 60 * 1000); // 10 minutes

  test('TS Engine — passive tick advancement', async ({ page }) => {
    ensureDir();
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    console.log('TS: Loading SCG01EA in agent mode...');
    await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG01EA&difficulty=normal`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30_000 });

    // Wait for agent harness
    await page.waitForFunction(
      () => (window as unknown as { __agentReady?: boolean }).__agentReady === true,
      { timeout: 120_000, polling: 1000 },
    );
    console.log('TS: Agent harness ready');

    // Get initial state (tick 0)
    const initialState = await page.evaluate(() => {
      return (window as unknown as { __agentState: () => Record<string, unknown> }).__agentState();
    });
    console.log(`TS: Initial tick=${initialState.tick}, state=${initialState.state}`);

    // Capture tick 0
    const img0 = await captureCanvas(page);
    if (img0) saveDataUrl(img0, path.join(OUT_DIR, `ts-tick-${pad(0)}.png`));
    saveJson(summarizeState(initialState), path.join(OUT_DIR, `ts-state-${pad(0)}.json`));
    saveJson(initialState, path.join(OUT_DIR, `ts-full-state-${pad(0)}.json`));

    // Step through checkpoints
    let currentTick = Number(initialState.tick) || 0;

    for (const target of CHECKPOINTS) {
      if (target <= currentTick) continue;

      const delta = target - currentTick;
      console.log(`TS: Stepping ${delta} ticks → tick ${target}...`);

      const result = await page.evaluate((n: number) => {
        return (window as unknown as {
          __agentStep: (n: number) => { state: Record<string, unknown> };
        }).__agentStep(n);
      }, delta);

      const state = result.state;
      currentTick = Number(state.tick) || target;

      // Capture screenshot
      const img = await captureCanvas(page);
      if (img) saveDataUrl(img, path.join(OUT_DIR, `ts-tick-${pad(target)}.png`));
      saveJson(summarizeState(state), path.join(OUT_DIR, `ts-state-${pad(target)}.json`));

      const summary = summarizeState(state);
      console.log(`TS: tick=${summary.tick} units=${summary.unitCount} enemies=${summary.enemyCount} structs=${summary.structureCount} credits=${summary.credits}`);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'ts-console.log'), logs.join('\n'));
    console.log('TS: Done');
  });

  test('WASM Original — passive tick advancement', async ({ page }) => {
    ensureDir();
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(`[${msg.type()}] ${text}`);
      if (text.includes('[AUTOPLAY]') || text.includes('[AGENT]')) console.log(`WASM: ${text}`);
    });
    page.on('dialog', async dialog => {
      console.log(`WASM: Dialog dismissed: ${dialog.message()}`);
      await dialog.accept();
    });

    console.log('WASM: Loading SCG01EA...');
    await page.goto(`${BASE_URL}/ra/original.html?scenario=SCG01EA.INI&autoplay=1&agentharness=1`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30_000 });

    // Phase 1: Wait for WASM + autoplay to enter game loop
    // Uses waitForFunction (in-page polling) — never call WASM functions via evaluate
    // during Asyncify operations, it deadlocks.
    console.log('WASM: Phase 1 — waiting for game loop entry (__autoplayReady)...');
    try {
      await page.waitForFunction(() => {
        const w = window as unknown as { __autoplayReady?: boolean };
        if (w.__autoplayReady === true) return true;
        const t = document.title;
        return t.includes('ENTERING_GAME_LOOP') || t.includes('SELECT_GAME_DONE');
      }, { timeout: 180_000, polling: 1000 });
      console.log('WASM: Game loop entered');
    } catch {
      console.log('WASM: Game loop entry timeout — attempting Phase 2 anyway');
    }

    // Phase 2: Wait for agent_get_state to return valid data (units present).
    // Must use waitForFunction — page.evaluate can hang with Asyncify.
    // Check Asyncify.state === 0 before calling ccall.
    console.log('WASM: Phase 2 — waiting for valid agent_get_state...');
    try {
      await page.waitForFunction(() => {
        try {
          const Asyncify = (window as unknown as { Asyncify?: { state: number } }).Asyncify;
          if (Asyncify && Asyncify.state !== 0) return false;
          const Module = (window as unknown as { Module?: { ccall: Function } }).Module;
          if (!Module?.ccall) return false;
          const json = Module.ccall('agent_get_state', 'string', [], []);
          const state = JSON.parse(json as string);
          return Array.isArray(state.units) && state.units.length > 0;
        } catch { return false; }
      }, { timeout: 120_000, polling: 1000 });
      console.log('WASM: Gameplay state available');
    } catch {
      console.log('WASM: Gameplay state not available — aborting');
      await page.screenshot({ path: path.join(OUT_DIR, 'wasm-no-gameplay.png') });
      fs.writeFileSync(path.join(OUT_DIR, 'wasm-console.log'), logs.join('\n'));
      return;
    }

    // Now safe to use page.evaluate with async __agentStep
    // (game loop is yielding via emscripten_sleep(1) every frame)
    const initialState = await page.evaluate(async () => {
      const w = window as unknown as { __agentState: () => Record<string, unknown> };
      return w.__agentState();
    });
    const startTick = Number(initialState.tick) || 0;
    console.log(`WASM: Initial tick=${startTick}, units=${(initialState.units as unknown[])?.length}`);

    // Capture tick 0 (relative — WASM may already be a few ticks in from autoplay)
    const img0 = await captureCanvas(page);
    if (img0) saveDataUrl(img0, path.join(OUT_DIR, `wasm-tick-${pad(0)}.png`));
    saveJson(summarizeState(initialState), path.join(OUT_DIR, `wasm-state-${pad(0)}.json`));
    saveJson(initialState, path.join(OUT_DIR, `wasm-full-state-${pad(0)}.json`));

    // Step through checkpoints
    // WASM may have started a few ticks in — step relative to start
    let currentTick = startTick;

    for (const target of CHECKPOINTS) {
      if (target <= 0) continue; // already captured tick 0

      const absoluteTarget = startTick + target;
      const delta = absoluteTarget - currentTick;
      if (delta <= 0) continue;

      console.log(`WASM: Stepping ${delta} ticks → relative tick ${target}...`);

      const stepResult = await wasmStep(page, delta);

      if (!stepResult?.state) {
        console.log(`WASM: Step to tick ${target} timed out — skipping`);
        continue;
      }

      const state = stepResult.state;
      currentTick = Number(state.tick) || absoluteTarget;

      // Capture screenshot
      // WASM renders via putImageData — need a brief moment for the render to land
      await page.waitForTimeout(200);
      const img = await captureCanvas(page);
      if (img) saveDataUrl(img, path.join(OUT_DIR, `wasm-tick-${pad(target)}.png`));
      saveJson(summarizeState(state), path.join(OUT_DIR, `wasm-state-${pad(target)}.json`));

      const summary = summarizeState(state);
      console.log(`WASM: tick=${summary.tick} units=${summary.unitCount} enemies=${summary.enemyCount} structs=${summary.structureCount} credits=${summary.credits}`);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'wasm-console.log'), logs.join('\n'));
    console.log('WASM: Done');
  });

  test('Generate comparison summary', async ({}) => {
    ensureDir();

    const summary: Record<string, unknown> = { checkpoints: [] };
    const checkpoints: Array<Record<string, unknown>> = [];

    for (const tick of [0, ...CHECKPOINTS.filter(t => t > 0)]) {
      const tsPath = path.join(OUT_DIR, `ts-state-${pad(tick)}.json`);
      const wasmPath = path.join(OUT_DIR, `wasm-state-${pad(tick)}.json`);

      if (!fs.existsSync(tsPath) || !fs.existsSync(wasmPath)) continue;

      const ts = JSON.parse(fs.readFileSync(tsPath, 'utf-8'));
      const wasm = JSON.parse(fs.readFileSync(wasmPath, 'utf-8'));

      const diff: Record<string, unknown> = {
        tick,
        unitCount: { ts: ts.unitCount, wasm: wasm.unitCount, match: ts.unitCount === wasm.unitCount },
        enemyCount: { ts: ts.enemyCount, wasm: wasm.enemyCount, match: ts.enemyCount === wasm.enemyCount },
        structureCount: { ts: ts.structureCount, wasm: wasm.structureCount, match: ts.structureCount === wasm.structureCount },
        credits: { ts: ts.credits, wasm: wasm.credits, match: ts.credits === wasm.credits },
        unitsByType: { ts: ts.unitsByType, wasm: wasm.unitsByType },
        enemiesByType: { ts: ts.enemiesByType, wasm: wasm.enemiesByType },
      };

      checkpoints.push(diff);
    }

    summary.checkpoints = checkpoints;
    saveJson(summary, path.join(OUT_DIR, 'summary.json'));
    console.log(`Summary: ${checkpoints.length} checkpoints compared`);
    for (const cp of checkpoints) {
      const u = cp.unitCount as { ts: number; wasm: number; match: boolean };
      const e = cp.enemyCount as { ts: number; wasm: number; match: boolean };
      const s = cp.structureCount as { ts: number; wasm: number; match: boolean };
      console.log(`  tick ${cp.tick}: units=${u.ts}/${u.wasm}${u.match ? '✓' : '✗'} enemies=${e.ts}/${e.wasm}${e.match ? '✓' : '✗'} structs=${s.ts}/${s.wasm}${s.match ? '✓' : '✗'}`);
    }
  });
});
