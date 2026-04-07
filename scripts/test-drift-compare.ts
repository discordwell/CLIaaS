import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG08EA: compare batch vs tick-by-tick WASM stepping', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);

  // Run TWO WASM instances: one with batch stepping, one with tick-by-tick
  const batchCtx = await browser.newContext();
  const tickCtx = await browser.newContext();
  const batchPage = await batchCtx.newPage();
  const tickPage = await tickCtx.newPage();
  batchPage.on('dialog', async d => { await d.accept(); });
  tickPage.on('dialog', async d => { await d.accept(); });

  const url = BASE_URL + '/ra/original.html?scenario=SCG08EA.INI&autoplay=1&agentharness=1&seed=0';
  await Promise.all([
    batchPage.goto(url, { waitUntil: 'load' }),
    tickPage.goto(url, { waitUntil: 'load' }),
  ]);

  const waitFn = () => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } };
  await Promise.all([
    batchPage.waitForFunction(waitFn, { timeout: 120000, polling: 2000 }),
    tickPage.waitForFunction(waitFn, { timeout: 120000, polling: 2000 }),
  ]);

  // Both start from the same state. Step to tick 2000 differently:

  // BATCH: agent_step(300) × 7 (2100 ticks via 300-tick batches, capped at 300 per call)
  console.log('Stepping BATCH to 2100...');
  await batchPage.evaluate(async () => {
    for (let i = 0; i < 7; i++) {
      const r = (window as any).__agentStep(300);
      if (r?.then) await r;
    }
  });

  // TICK-BY-TICK: agent_step(1) × 2100
  console.log('Stepping TICK-BY-TICK to 2100...');
  await tickPage.evaluate(async () => {
    for (let i = 0; i < 2100; i++) {
      const r = (window as any).__agentStep(1);
      if (r?.then) await r;
    }
  });

  // Compare
  const batchState = await batchPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return { tick: s.tick, mt: s.missionTimer, mta: s.missionTimerActive, units: s.units?.length };
  });
  const tickState = await tickPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return { tick: s.tick, mt: s.missionTimer, mta: s.missionTimerActive, units: s.units?.length };
  });

  console.log('BATCH:  tick=' + batchState.tick + ' timer=' + batchState.mt + ' active=' + batchState.mta + ' units=' + batchState.units);
  console.log('TICKBT: tick=' + tickState.tick + ' timer=' + tickState.mt + ' active=' + tickState.mta + ' units=' + tickState.units);
  console.log('Timer delta: ' + (batchState.mt - tickState.mt));

  await batchCtx.close();
  await tickCtx.close();
});
