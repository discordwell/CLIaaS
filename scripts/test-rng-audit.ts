import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG02EA tick-15 entity state', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => d.accept());

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=SCG02EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=SCG02EA&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  // Step to tick 14
  await Promise.all([
    (async () => { for (let i = 0; i < 14; i++) { try { await wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }); } catch {} } })(),
    tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 14),
  ]);

  // Get detailed state at tick 14 (before the divergence tick)
  const [w, ts] = await Promise.all([
    wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return {
        rng: s.rngState, calls: s.rngCalls,
        units: (s.units || []).map((u: any) => u.type || u.t),
        enemies: (s.enemies || []).map((u: any) => ({ t: u.type || u.t, x: u.cx, y: u.cy, hp: u.hp, m: u.mission })),
      };
    }),
    tsPage.evaluate(() => {
      const s = (window as any).__agentState();
      return {
        rng: s.rngState, calls: s.rngCalls,
        units: (s.units || []).map((u: any) => u.type || u.t),
        enemies: (s.enemies || []).map((u: any) => ({ t: u.type || u.t, x: u.cx, y: u.cy, hp: u.hp, m: u.mission })),
      };
    }),
  ]);

  console.log('=== STATE AT TICK 14 ===');
  console.log('Seeds match:', w.rng === ts.rng, '(W=' + w.rng + ' T=' + ts.rng + ')');
  console.log('RNG calls: W=' + w.calls + ' T=' + ts.calls);

  // Compare enemy missions
  let missionDiffs = 0;
  for (let i = 0; i < Math.min(w.enemies.length, ts.enemies.length); i++) {
    const we = w.enemies[i];
    const te = ts.enemies[i];
    if (we.m !== te.m || we.x !== te.x || we.y !== te.y) {
      console.log('Enemy ' + i + ': W=' + we.t + '@(' + we.x + ',' + we.y + ') m=' + we.m + 
        ' | T=' + te.t + '@(' + te.x + ',' + te.y + ') m=' + te.m);
      missionDiffs++;
    }
  }
  console.log('Enemy mission/position diffs: ' + missionDiffs + '/' + w.enemies.length);

  await wasmCtx.close();
  await tsCtx.close();
});
