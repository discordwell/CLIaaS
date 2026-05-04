/**
 * Trace WASM 852084 + TS equivalent (USSR E1 at 59,61) over many ticks
 * to find when WASM stops walking but TS keeps going.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;

test('SCG13EA 852084 walk trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
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

  let prevWasm = '', prevTs = '';
  for (let t = 0; t <= 115; t++) {
    if (t > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
    const wasm = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      const u = all.find((x: { id: number }) => x.id === 852084);
      return u ? `m=${u.m} mt=${u.mt} mq=${u.mq} drv=${u.drv} doing=${u.doing} c=(${u.cx},${u.cy}) ` +
        `pos=(${u.lx},${u.ly}) head=${u.hlx !== undefined ? `(${u.hlx},${u.hly})` : 'null'} ` +
        `nav=${u.nlx !== undefined ? `(${u.nlx},${u.nly})` : 'null'} p0=${u.p0} spd=${u.spd}` : '?';
    });
    const ts = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return '?';
      // TS equivalent of WASM 852084 in the current logic order.
      let e = game.entities.find((x: { alive: boolean; id: number }) => x.alive && x.id === 286);
      if (!e) {
        e = game.entities.find((x: { alive: boolean; type: string; house: string; teamRef?: { id: number } }) =>
          x.alive && x.type === 'E1' && x.house === 'USSR' && x.teamRef?.id === 1);
      }
      if (!e) return '?';
      const speed = Math.floor(game.movementSpeed ? game.movementSpeed(e) / (24 / 256) : -1);
      const head = e.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : 'null';
      const nav = e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : 'null';
      const path = `${e.pathIndex}/${e.path?.length ?? 0}:${(e.path ?? []).slice(e.pathIndex, e.pathIndex + 3)
        .map((p: { cx: number; cy: number }) => `${p.cx},${p.cy}`).join('|')}`;
      return `[id=${e.id} c=(${e.cell.cx},${e.cell.cy})] m=${e.mission} mt=${e.missionTimer} mq=${e.missionQueue ?? 'null'} ` +
        `drv=${e.isDriving} init=${e.teamInitiated} doing=${e.doing} pos=(${e.leptonX},${e.leptonY}) head=${head} nav=${nav} ` +
        `path=${path} max=${speed}`;
    });
    if (wasm !== prevWasm || ts !== prevTs) {
      console.log(`t=${t} W: ${wasm} | TS: ${ts}`);
      prevWasm = wasm;
      prevTs = ts;
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
