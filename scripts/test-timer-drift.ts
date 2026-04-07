import { test } from '@playwright/test';

const SCENARIO = process.env.SCENARIO || 'SCG02EA';
const BASE_URL = 'https://cliaas.com';

test.describe('Timer Drift Investigation', () => {
  test.setTimeout(5 * 60 * 1000);

  test(`${SCENARIO} timer at checkpoints`, async ({ browser }) => {
    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const wasmPage = await wasmCtx.newPage();
    const tsPage = await tsCtx.newPage();
    wasmPage.on('dialog', async d => { await d.accept(); });

    await Promise.all([
      wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
      tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`, { waitUntil: 'load' }),
    ]);

    await Promise.all([
      wasmPage.waitForFunction(() => {
        try {
          const M = (window as any).Module;
          return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
        } catch { return false; }
      }, { timeout: 120_000, polling: 2000 }),
      tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000 }),
    ]);

    const wasmSeed = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
    });
    await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

    // Step both in sync, checking timer every 100 ticks
    let prevTick = 0;
    for (let target = 100; target <= 15000; target += 100) {
      const step = target - prevTick;
      await Promise.all([
        (async () => {
          let rem = step;
          while (rem > 0) {
            const chunk = Math.min(rem, 10);
            rem -= chunk;
            try {
              await wasmPage.evaluate(async (n: number) => {
                const r = (window as any).__agentStep(n);
                if (r?.then) await r;
              }, chunk);
            } catch { break; }
          }
        })(),
        tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, step),
      ]);
      prevTick = target;

      const [wasm, ts] = await Promise.all([
        wasmPage.evaluate(() => {
          const M = (window as any).Module;
          const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
          return { tick: s.tick, mt: s.missionTimer ?? 0, mta: s.missionTimerActive ?? false };
        }),
        tsPage.evaluate(() => {
          const s = (window as any).__agentState();
          return { tick: s.tick, mt: s.missionTimer ?? 0 };
        }),
      ]);
      const delta = ts.mt - wasm.mt;
      if (delta !== 0 || target % 500 === 0) {
        console.log(`t${target}: WASM=${wasm.mt} TS=${ts.mt} delta=${delta} wasmActive=${wasm.mta}`);
      }
    }

    await wasmCtx.close();
    await tsCtx.close();
  });
});
