/**
 * Trace WASM 852084 + TS equivalent (USSR E1 at 59,61) over many ticks
 * to find when WASM stops walking but TS keeps going.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const END = Number(process.env.END ?? 115);
const START_PRINT = Number(process.env.START_PRINT ?? 0);
const TRACE_TS_UPDATE = process.env.TRACE_TS_UPDATE === '1';

test('SCG13EA 852084 walk trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  tsPage.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[TRACE286]')) console.log(text);
  });

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
  await wasmPage.evaluate((id: number) => { (window as any).__traceWasmId = id; }, Number(process.env.WASM_ID ?? 852084));
  await tsPage.evaluate((id: number) => { (window as any).__traceTsId = id; }, Number(process.env.TS_ID ?? 286));

  let prevWasm = '', prevTs = '';
  for (let t = 0; t <= END; t++) {
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
      const wasmId = Number((window as any).__traceWasmId ?? 852084);
      const u = all.find((x: { id: number }) => x.id === wasmId);
      return u ? `m=${u.m} mt=${u.mt} mq=${u.mq} drv=${u.drv} doing=${u.doing} c=(${u.cx},${u.cy}) ` +
        `pos=(${u.lx},${u.ly}) head=${u.hlx !== undefined ? `(${u.hlx},${u.hly})` : 'null'} ` +
        `nav=${u.nlx !== undefined ? `(${u.nlx},${u.nly})` : 'null'} p0=${u.p0} spd=${u.spd} fm=${u.fm} adsc=${u.adsc}` : '?';
    });
    const ts = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return '?';
      const tsId = Number((window as any).__traceTsId ?? 286);
      let e = game.entities.find((x: { alive: boolean; id: number }) => x.alive && x.id === tsId);
      if (!e) {
        e = game.entities.find((x: { alive: boolean; type: string; house: string; teamRef?: { id: number } }) =>
          x.alive && x.type === 'E1' && x.house === 'USSR' && x.teamRef?.id === 1);
      }
      if (!e) return '?';
      const speed = Math.floor(game.movementSpeed ? game.movementSpeed(e) / (24 / 256) : -1);
      const head = e.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : 'null';
      const nav = e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : 'null';
      const idx = e.cell.cy * 128 + e.cell.cx;
      const map = game.map;
      const clr = map ? `${map.getTerrain?.(e.cell.cx, e.cell.cy)}/veh=${map.vehicleOccupancy?.has(idx)}/trk=${map.vehicleTrackReservations?.has(idx)}/tree=${map.treeOccupied?.has(idx)}` : 'n/a';
      const path = `${e.pathIndex}/${e.path?.length ?? 0}:${(e.path ?? []).slice(e.pathIndex, e.pathIndex + 3)
        .map((p: { cx: number; cy: number }) => `${p.cx},${p.cy}`).join('|')}`;
      const next = e.path?.[e.pathIndex];
      const nextIdx = next ? next.cy * 128 + next.cx : -1;
      const nextSlots = next && map ? `${next.cx},${next.cy}=[${map.subCellOccupancy?.get(nextIdx)?.join(',') ?? '-'}]` : '-';
      const curSlots = map ? `[${map.subCellOccupancy?.get(idx)?.join(',') ?? '-'}]` : 'n/a';
      return `[id=${e.id} c=(${e.cell.cx},${e.cell.cy})] m=${e.mission} mt=${e.missionTimer} mq=${e.missionQueue ?? 'null'} ` +
        `drv=${e.isDriving} init=${e.teamInitiated} doing=${e.doing} fire=${e.firePrepActive}/${e.isFiringAnim} ` +
        `pd=${e.pathDelay} nct=${e.navComClearedTick} pos=(${e.leptonX},${e.leptonY}) head=${head} nav=${nav} ` +
        `path=${path} slots=${curSlots} nextSlots=${nextSlots} max=${speed} fm=${e.formationOffset ? 'true' : 'false'} clr=${clr}`;
    });
    if (t >= START_PRINT && (wasm !== prevWasm || ts !== prevTs)) {
      console.log(`t=${t} W: ${wasm} | TS: ${ts}`);
      prevWasm = wasm;
      prevTs = ts;
    }
    if (TRACE_TS_UPDATE && t === 112) {
      await tsPage.evaluate(() => {
        const game = (window as any).__agentGame;
        const tsId = Number((window as any).__traceTsId ?? 286);
        const e = game.entities.find((x: { id: number }) => x.id === tsId);
        if (!e || e.__traceWrapped) return;
        e.__traceWrapped = true;
        const oldUpdateMove = game.updateMove?.bind(game);
        if (oldUpdateMove) {
          game.updateMove = (ent: any, ...args: any[]) => {
            if (ent.id === tsId) {
              console.log(`[TRACE286] updateMove tick=${game.tick} id=${ent.id} m=${ent.mission} mt=${ent.missionTimer} mq=${ent.missionQueue} drv=${ent.isDriving} nav=${ent.moveTarget ? `(${ent.moveTarget.lx},${ent.moveTarget.ly})` : 'null'} head=(${ent.headToLX},${ent.headToLY}) path=${ent.pathIndex}/${ent.path?.length}`);
            }
            return oldUpdateMove(ent, ...args);
          };
        }
        const old = e.moveToward.bind(e);
        e.moveToward = (target: { lx: number; ly: number }, speed: number) => {
          console.log(`[TRACE286] before moveToward tick=${game.tick} pos=(${e.leptonX},${e.leptonY}) target=(${target.lx},${target.ly}) speed=${speed} m=${e.mission} mq=${e.missionQueue} nav=${e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : 'null'} path=${e.pathIndex}/${e.path?.length}`);
          const ret = old(target, speed);
          console.log(`[TRACE286] after moveToward tick=${game.tick} pos=(${e.leptonX},${e.leptonY}) ret=${ret} drv=${e.isDriving} head=(${e.headToLX},${e.headToLY}) path=${e.pathIndex}/${e.path?.length}`);
          return ret;
        };
      });
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
