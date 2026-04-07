import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG08EA state at freeze point', async ({ browser }) => {
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

  // Step to tick 1880 in bulk
  await Promise.all([
    (async () => { let r = 1880; while (r > 0) { const c = Math.min(r, 10); r -= c; try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, c); } catch { break; } } })(),
    tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1880),
  ]);

  // Then step 1 tick at a time from 1881 to 1900
  for (let t = 1881; t <= 1900; t++) {
    await Promise.all([
      (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 1); } catch {} })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1),
    ]);
    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        return {
          tick: s.tick, mt: s.missionTimer, mta: s.missionTimerActive,
          units: s.units?.length, enemies: s.enemies?.length,
          structs: s.structures?.length, credits: s.credits,
          globals: s.globals, winPending: s.winPending, losePending: s.losePending,
        };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        return {
          tick: s.tick, mt: s.missionTimer,
          units: s.units?.length, enemies: s.enemies?.length,
          structs: s.structures?.length, credits: s.credits,
          globals: s.globals, allowWin: s.allowWin,
        };
      }),
    ]);
    const d = (ts.mt ?? 0) - (w.mt ?? 0);
    console.log('t' + t + ': timer WASM=' + w.mt + ' TS=' + ts.mt + ' delta=' + d
      + ' | units W=' + w.units + ' T=' + ts.units
      + ' | enemies W=' + w.enemies + ' T=' + ts.enemies
      + ' | structs W=' + w.structs + ' T=' + ts.structs
      + ' | credits W=' + w.credits + ' T=' + ts.credits
      + ' | globals W=' + JSON.stringify(w.globals) + ' T=' + JSON.stringify(ts.globals)
      + ' | win=' + w.winPending + '/' + ts.allowWin
      + ' | lose=' + w.losePending);
  }
  await wasmCtx.close();
  await tsCtx.close();
});
