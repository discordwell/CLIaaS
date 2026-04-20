/**
 * First-divergence finder — for each scenario, report the tick# where
 * WASM and TS first disagree on (RNG call count OR post-tick seed).
 *
 * Usage:
 *   npx playwright test scripts/test-first-divergence.ts --reporter=list
 *   SCENARIOS=SCG04EA,SCG11EA MAX=500 npx playwright test scripts/test-first-divergence.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const ALL = ['SCG01EA','SCG03EA','SCG04EA','SCG06EA','SCG07EA','SCG11EA','SCG13EA'];
const scenarios = process.env.SCENARIOS?.split(',') ?? ALL;
const maxTicks = Number(process.env.MAX ?? 500);

for (const scenario of scenarios) {
  test(`${scenario} first divergence`, async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000);
    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const wp = await wasmCtx.newPage();
    const tp = await tsCtx.newPage();
    wp.on('dialog', async d => { await d.accept(); });

    await Promise.all([
      wp.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
      tp.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
    ]);
    await Promise.all([
      wp.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
      tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
    ]);
    const wasmSeed = await wp.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
    });
    await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

    // Enable TS tag logging so __rngTagControl('read') returns per-tick log.
    await tp.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

    let firstDivergentTick = -1;
    let divergenceReason = '';
    for (let tick = 1; tick <= maxTicks; tick++) {
      // Reset TS log before the step so the read returns only this tick's
      // entries (WASM's agent_get_state resets its log after each read).
      await tp.evaluate(() => { (window as any).__rngTagControl?.('reset'); });
      const [wRes, _] = await Promise.all([
        wp.evaluate(async () => {
          const r = (window as any).__agentStep(1);
          const res = r?.then ? await r : r;
          const s = res?.state ?? res;
          return { seed: s.rngState as number, calls: s.rngCalls as number, log: s.rngLog ?? [] };
        }),
        tp.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
      const tRes = await tp.evaluate(() => {
        const r = (window as any).__rngTagControl?.('read') ?? { seed: 0, seedLog: [] };
        return { seed: r.seed as number, log: r.seedLog ?? [] };
      });
      const seedMatch = (wRes.seed >>> 0) === (tRes.seed >>> 0);
      const callDiff = wRes.log.length - tRes.log.length;
      if (!seedMatch || callDiff !== 0) {
        firstDivergentTick = tick;
        divergenceReason = `WASM(${wRes.log.length}, seed=${wRes.seed >>> 0}) TS(${tRes.log.length}, seed=${tRes.seed >>> 0}) Δcalls=${callDiff}`;
        break;
      }
    }
    if (firstDivergentTick === -1) {
      console.log(`${scenario}: no divergence in ${maxTicks} ticks ✓`);
    } else {
      console.log(`${scenario}: first divergence @ tick ${firstDivergentTick} — ${divergenceReason}`);
    }
    await wasmCtx.close();
    await tsCtx.close();
  });
}
