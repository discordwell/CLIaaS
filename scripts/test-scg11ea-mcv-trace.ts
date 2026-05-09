/**
 * SCG11EA tick-by-tick MCV position trace — WASM vs TS.
 * Dumps Coord_X, Coord_Y, Mission, MissionTimer, IsDriving, MissionQueue
 * for the two Greece MCVs over START..END to understand WHEN cell
 * boundaries are crossed and WHEN Mission_Move fires.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const START = Number(process.env.START ?? '1');
const END = Number(process.env.END ?? '35');

test('SCG11EA MCV per-tick coord trace', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext();
  const page = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  page.on('dialog', async d => { await d.accept(); });
  tsPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    page.goto(
      `${BASE_URL}/ra/original.html?scenario=SCG11EA.INI&autoplay=1&agentharness=1&seed=0`,
      { waitUntil: 'load' },
    ),
    tsPage.goto(`${TS_BASE_URL}/?anttest=agent&scenario=SCG11EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([page.waitForFunction(() => {
    try {
      const M = (window as any).Module;
      return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
    } catch { return false; }
  }, { timeout: 180_000, polling: 2000 }), tsPage.waitForFunction(() => (window as any).__agentGame?.entities?.length > 0, { timeout: 180_000 })]);

  const wasmSeed = await page.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tsPage.evaluate((seed: number) => {
    (window as any).__syncRngSeed?.(seed);
  }, wasmSeed);

  if (START > 1) {
    await Promise.all([
      page.evaluate((n) => (window as any).__agentStep(n), START - 1),
      tsPage.evaluate((n) => (window as any).__agentStep(n), START - 1),
    ]);
  }

  console.log('\ntick | engine | MCV west                                      | MCV east');
  console.log('-----+--------+-----------------------------------------------+-----------------------------------------------');

  for (let tick = START; tick <= END; tick++) {
    const [state, tsState] = await Promise.all([page.evaluate(() => {
      const M = (window as any).Module;
      const r = (window as any).__agentStep(1);
      return r?.then ? r.then(() => JSON.parse(M.ccall('agent_get_state', 'string', [], []))) :
        JSON.parse(M.ccall('agent_get_state', 'string', [], []));
    }), tsPage.evaluate(() => {
      const read = () => {
        const game = (window as any).__agentGame;
        return game.entities
          .filter((e: any) => e.alive && e.type === 'MCV')
          .sort((a: any, b: any) => a.cell.cx - b.cell.cx)
          .map((e: any) => ({
            id: e.id, lx: e.leptonX, ly: e.leptonY, cx: e.cell.cx, cy: e.cell.cy,
            m: e.mission, mt: e.missionTimer, drv: e.isDriving, mq: e.missionQueue,
            nlx: e.moveTarget?.lx ?? null, nly: e.moveTarget?.ly ?? null,
            pathLen: e.path?.length ?? 0, pathIndex: e.pathIndex,
          }));
      };
      const r = (window as any).__agentStep(1);
      return r?.then ? r.then(read) : read();
    })]);
    const units = state.units || [];
    const mcvs = units.filter((u: any) => u.t === 'MCV').sort((a: any, b: any) => a.cx - b.cx);

    const fmt = (u: any) => {
      if (!u) return '(missing)'.padEnd(45);
      const nav = (u.nlx !== undefined) ? `${u.nlx},${u.nly}` : '-';
      return `id=${String(u.id).padEnd(7)} ${String(u.lx).padStart(6)} ${String(u.ly).padStart(6)} (${u.cx},${u.cy}) m=${String(u.m).padEnd(5)} mt=${String(u.mt).padStart(2)} drv=${u.drv?'T':'F'} mq=${String(u.mq).padEnd(4)} nav=${nav.padEnd(11)} p=${u.pathLen ?? '-'}:${u.pathIndex ?? '-'}`;
    };
    console.log(`${String(tick).padStart(4)} | WASM   | ${fmt(mcvs[0])} | ${fmt(mcvs[1])}`);
    console.log(`${String(tick).padStart(4)} | TS     | ${fmt(tsState[0])} | ${fmt(tsState[1])}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
