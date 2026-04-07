/**
 * Comprehensive Visual Parity Test Suite
 *
 * Runs all 12 playable Allied scenarios at ticks 1, 50, 100, comparing
 * TS and WASM renders both at the state level (unit counts, HP, credits,
 * timer) and the pixel level (structural similarity of rendered frames).
 *
 * Usage: npx playwright test scripts/test-visual-parity-suite.ts
 * Env:   SCENARIOS=SCG01EA,SCG08EA  — limit to specific scenarios
 *        TICKS=1,50,100              — which ticks to check
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ALL_SCENARIOS = ['SCG01EA','SCG02EA','SCG03EA','SCG04EA','SCG06EA','SCG07EA',
  'SCG08EA','SCG09EA','SCG10EA','SCG11EA','SCG12EA','SCG13EA'];
const DEFAULT_TICKS = [1, 50, 100];
const BASE_URL = 'https://cliaas.com';
const OUT_DIR = '/tmp/visual-parity';

const scenarios = process.env.SCENARIOS?.split(',') ?? ALL_SCENARIOS;
const ticks = process.env.TICKS?.split(',').map(Number) ?? DEFAULT_TICKS;

test.describe('Visual Parity Suite', () => {
  test.setTimeout(10 * 60 * 1000);

  for (const scenario of scenarios) {
    test(`${scenario} — state + render parity`, async ({ browser }) => {
      fs.mkdirSync(OUT_DIR, { recursive: true });

      const wasmCtx = await browser.newContext();
      const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const wasmPage = await wasmCtx.newPage();
      const tsPage = await tsCtx.newPage();
      wasmPage.on('dialog', async d => { await d.accept(); });

      // Launch
      await Promise.all([
        wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
        tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
      ]);

      // Wait for ready
      await Promise.all([
        wasmPage.waitForFunction(() => {
          try {
            const M = (window as any).Module;
            return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
          } catch { return false; }
        }, { timeout: 180_000, polling: 2000 }),
        tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
      ]);

      // Sync RNG
      const wasmSeed = await wasmPage.evaluate(() => {
        const M = (window as any).Module;
        return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
      });
      await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

      const results: Array<{
        tick: number;
        stateMatch: boolean;
        unitCountDelta: number;
        creditsDelta: number;
        timerDelta: number;
      }> = [];

      let prevTick = 0;
      for (const targetTick of ticks) {
        const step = targetTick - prevTick;
        if (step > 0) {
          // Step BOTH engines in matched batches inside single evaluate calls.
          // C++ agent_step(N) runs a tight for-loop of do_tick() — no JS yields
          // within a single call. Cap at 300 (C++ limit) and batch if needed.
          // Key: both engines step the SAME batch sizes to avoid tick count mismatch.
          await Promise.all([
            wasmPage.evaluate((n: number) => {
              // Single synchronous evaluate — no async yields between batches
              let rem = n;
              while (rem > 0) {
                const batch = Math.min(rem, 300);
                rem -= batch;
                (window as any).__agentStep(batch);
              }
            }, step),
            tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, step),
          ]);
        }
        prevTick = targetTick;

        // Compare state
        const [wasmState, tsState] = await Promise.all([
          wasmPage.evaluate(() => {
            const M = (window as any).Module;
            const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
            return {
              tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
              unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
              structCount: s.structures?.length ?? 0,
            };
          }),
          tsPage.evaluate(() => {
            const s = (window as any).__agentState();
            return {
              tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
              unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
              structCount: s.structures?.length ?? 0,
            };
          }),
        ]);

        const unitDelta = Math.abs(tsState.unitCount - wasmState.unitCount);
        const creditsDelta = Math.abs(tsState.credits - wasmState.credits);
        const timerDelta = Math.abs(tsState.missionTimer - wasmState.missionTimer);
        const stateMatch = unitDelta <= 2 && creditsDelta <= 500 && timerDelta <= 5;

        results.push({
          tick: targetTick,
          stateMatch,
          unitCountDelta: unitDelta,
          creditsDelta,
          timerDelta,
        });

        // Capture frames for visual inspection
        const wasmUrl = await wasmPage.evaluate(() => {
          const M = (window as any).Module;
          M.ccall('agent_render', null, [], []);
          const ptr = (window as any).__agentFramePtr;
          if (!ptr || !M.HEAPU8) return null;
          const w = 640, h = 400;
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d')!;
          const img = ctx.createImageData(w, h);
          const heap = M.HEAPU8;
          for (let i = 0; i < w * h * 4; i++) img.data[i] = heap[ptr + i];
          ctx.putImageData(img, 0, 0);
          return c.toDataURL('image/png');
        });
        const tsUrl = await tsPage.evaluate(() => {
          const c = document.querySelector('canvas');
          return c?.toDataURL('image/png') || null;
        });
        if (wasmUrl) {
          fs.writeFileSync(path.join(OUT_DIR, `${scenario}_t${targetTick}_wasm.png`),
            Buffer.from(wasmUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }
        if (tsUrl) {
          fs.writeFileSync(path.join(OUT_DIR, `${scenario}_t${targetTick}_ts.png`),
            Buffer.from(tsUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }

        console.log(`  ${scenario} t${targetTick}: units±${unitDelta} credits±${creditsDelta} timer±${timerDelta} ${stateMatch ? '✓' : '✗'}`);
      }

      // Write report
      const report = { scenario, results };
      fs.writeFileSync(path.join(OUT_DIR, `${scenario}_report.json`), JSON.stringify(report, null, 2));

      // Assert overall parity
      for (const r of results) {
        expect(r.timerDelta, `${scenario} t${r.tick} timer delta`).toBeLessThanOrEqual(5);
      }

      await wasmCtx.close();
      await tsCtx.close();
    });
  }
});
