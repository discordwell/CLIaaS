import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG08EA timer early ticks', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=SCG08EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=SCG08EA&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  // Check every tick from 0 to 50
  for (let t = 0; t <= 50; t++) {
    if (t > 0) {
      await Promise.all([
        (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 1); } catch {} })(),
        tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1),
      ]);
    }
    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => { const M = (window as any).Module; const s = JSON.parse(M.ccall('agent_get_state','string',[],[])); return { tick: s.tick, mt: s.missionTimer ?? 0, mta: s.missionTimerActive }; }),
      tsPage.evaluate(() => { const s = (window as any).__agentState(); return { tick: s.tick, mt: s.missionTimer ?? 0 }; }),
    ]);
    const d = ts.mt - w.mt;
    if (d !== 0 || w.mt !== 0 || ts.mt !== 0) {
      console.log('t' + t + ': WASM=' + w.mt + ' (tick=' + w.tick + ') TS=' + ts.mt + ' (tick=' + ts.tick + ') delta=' + d);
    }
  }
  await wasmCtx.close();
  await tsCtx.close();
});
