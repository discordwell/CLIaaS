/**
 * Trace the Greek E1 at (12,54) that is one guard-timer tick late in TS.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;

test('SCG13EA Greek E1 (12,54) guard timer trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmPage = await browser.newPage();
  const tsPage = await browser.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${TS_BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  let prev = '';
  for (let tick = 0; tick <= 116; tick++) {
    if (tick > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
    const line = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const all = [...(s.units ?? []), ...(s.enemies ?? [])];
        const u = all.find((x: { t: string; house: string; cx: number; cy: number }) =>
          x.t === 'E1' && x.house === 'Greece' && x.cx === 12 && x.cy === 54);
        return u ? `W id=${u.id} m=${u.m} mt=${u.mt} mq=${u.mq} drv=${u.drv} doing=${u.doing}` : 'W ?';
      }),
      tsPage.evaluate(() => {
        const game = (window as any).__agentGame;
        const e = game.entities.find((x: { alive: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
          x.alive && x.type === 'E1' && x.house === 'Greece' && x.cell.cx === 12 && x.cell.cy === 54);
        return e ? `TS id=${e.id} m=${e.mission} mt=${e.missionTimer} mq=${e.missionQueue ?? 'null'} drv=${e.isDriving} doing=${e.doing}` : 'TS ?';
      }),
    ]);
    const out = `t=${tick} ${line[0]} | ${line[1]}`;
    if (out !== prev) {
      console.log(out);
      prev = out;
    }
  }
});
