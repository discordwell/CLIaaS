/**
 * Configurable SCG13EA logic-layer window probe.
 *
 * Env:
 *   TICK=100
 *   WASM_FROM=180 WASM_TO=195
 *   TS_FROM=135 TS_TO=150
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const TICK = Number(process.env.TICK ?? '100');
const WASM_FROM = Number(process.env.WASM_FROM ?? '180');
const WASM_TO = Number(process.env.WASM_TO ?? '195');
const TS_FROM = Number(process.env.TS_FROM ?? '135');
const TS_TO = Number(process.env.TS_TO ?? '150');

test(`SCG13EA logic window tick ${TICK}`, async ({ browser }) => {
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

  for (let t = 0; t < TICK; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  const wasmRows = await wasmPage.evaluate(([from, to]) => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return (s.logicLayer ?? [])
      .filter((r: [number, string, string, number, number, string, number?, number?, number?, number?, boolean?, number?, number?, number?]) => r[0] >= from && r[0] <= to)
      .map((r: [number, string, string, number, number, string, number?, number?, number?, number?, boolean?, number?, number?, number?]) => {
        const u = all.find((x: { t: string; house: string; cx: number; cy: number }) =>
          x.t === r[1] && x.house === r[2] && x.cx === r[3] && x.cy === r[4]);
        return {
          logic: r[0], type: r[1], house: r[2], cell: `(${r[3]},${r[4]})`,
          direct: r.length >= 14 ? {
            id: r[6], m: r[7], mt: r[8], mq: r[9], drv: r[10], doing: r[11],
            pos: `(${r[12]},${r[13]})`,
          } : null,
          unit: u ? {
            id: u.id, m: u.m, mt: u.mt, mq: u.mq, drv: u.drv, init: u.init,
            doing: u.doing, pos: `(${u.lx},${u.ly})`,
            head: u.hlx !== undefined ? `(${u.hlx},${u.hly})` : null,
            nav: u.nlx !== undefined ? `(${u.nlx},${u.nly})` : null,
          } : null,
        };
      });
  }, [WASM_FROM, WASM_TO]);

  const tsRows = await tsPage.evaluate(([from, to]) => {
    const game = (window as any).__agentGame;
    const rows: Array<any> = [];
    let logic = 0;
    const pushEntity = (e: any, phase: string) => {
      if (logic >= from && logic <= to) {
        rows.push({
          logic, phase, id: e?.id, type: e?.type, house: e?.house,
          cell: e ? `(${e.cell.cx},${e.cell.cy})` : null,
          m: e?.mission, mt: e?.missionTimer, mq: e?.missionQueue ?? null,
          drv: e?.isDriving, init: e?.teamInitiated, doing: e?.doing,
          pos: e ? `(${e.leptonX},${e.leptonY})` : null,
          head: e?.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : null,
          nav: e?.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : null,
        });
      }
      logic++;
    };
    for (let i = 0; i < game._preBuildingEntityCount; i++) {
      const e = game.entities[i];
      if (!e || e.isAirUnit) continue;
      pushEntity(e, 'pre');
    }
    for (const s of game.structures) {
      if (logic >= from && logic <= to) {
        rows.push({ logic, phase: 'structure', type: s.type, house: s.house, cell: `(${s.cx},${s.cy})`, mt: s.missionTimer });
      }
      logic++;
    }
    for (let i = game._preBuildingEntityCount; i < game.entities.length; i++) {
      const e = game.entities[i];
      if (!e || e.isAirUnit) continue;
      pushEntity(e, 'post');
    }
    return rows;
  }, [TS_FROM, TS_TO]);

  console.log(`tick=${TICK}`);
  console.log('WASM');
  for (const row of wasmRows) console.log(JSON.stringify(row));
  console.log('TS');
  for (const row of tsRows) console.log(JSON.stringify(row));
});
