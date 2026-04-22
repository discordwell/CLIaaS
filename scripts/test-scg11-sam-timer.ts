/**
 * SCG11EA SAM missionTimer trace with synced WASM seed.
 *
 * Tracks struct[36-40, 45-47] missionTimer values across ticks 25-35 to confirm
 * when each SAM's Mission_Guard fires. Used in the tick-32 SAM investigation
 * (cpp-parity-scg11ea-t32-sam.test.ts) to identify the 1-tick offset between
 * TS and WASM SAM fires.
 *
 * Usage:
 *   npx playwright test scripts/test-scg11-sam-timer.ts --reporter=list
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG11EA SAM missionTimer trace with synced seed', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG11EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG11EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  console.log(`Synced seed: ${wasmSeed}`);

  const BULK_TO = 24;
  await Promise.all([
    wasmPage.evaluate(async (n: number) => {
      const r = (window as any).__agentStep(n);
      if (r?.then) await r;
    }, BULK_TO),
    tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, BULK_TO),
  ]);
  await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    JSON.parse(M.ccall('agent_get_state', 'string', [], []));
  });

  console.log(`\n=== SAM missionTimer trace ticks 25→35 ===\n`);
  console.log(`tick | struct[36] | struct[37] | struct[38] | struct[39] | struct[40] | struct[45] | struct[46] | struct[47]`);
  for (let tick = 25; tick <= 35; tick++) {
    await Promise.all([
      wasmPage.evaluate(async () => {
        const r = (window as any).__agentStep(1);
        if (r?.then) await r;
      }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const data = await tsPage.evaluate(() => {
      const g = (window as any).__agentGame;
      const samIdxs = [36, 37, 38, 39, 40, 45, 46, 47];
      return {
        tick: g.tick,
        mts: samIdxs.map(i => ({ i, mt: g.structures[i]?.missionTimer, type: g.structures[i]?.type })),
      };
    });
    const row = data.mts.map(m => `${String(m.mt).padStart(2)} ${m.type}`).join(' | ');
    console.log(`${String(tick).padStart(3)}  | ${row}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
