/**
 * Map SCG13EA RNG calls back to concrete WASM/TS objects.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const TICK = Number(process.env.TICK ?? '198');

test(`SCG13EA t${TICK} fire map`, async ({ browser }) => {
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
  await tsPage.evaluate(() => { (window as any).__rngTagControl('enable'); });

  for (let t = 0; t < TICK - 1; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  const wasmPre = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return (s.logicLayer ?? []).map((r: any[]) => ({
      logic: r[0], type: r[1], house: r[2], cell: `(${r[3]},${r[4]})`,
      id: r[6], m: r[7], mt: r[8], mq: r[9], drv: r[10], doing: r[11],
    }));
  });
  const tsPre = await tsPage.evaluate(() => {
    const game = (window as any).__agentGame;
    const rows: any[] = [];
    let logic = 0;
    const pushEntity = (e: any, phase: string) => {
      rows.push({
        logic, phase, id: e?.id, type: e?.type, house: e?.house,
        cell: e ? `(${e.cell.cx},${e.cell.cy})` : null,
        m: e?.mission, mt: e?.missionTimer, mq: e?.missionQueue ?? null,
        drv: e?.isDriving, doing: e?.doing,
      });
      logic++;
    };
    for (let i = 0; i < game._preBuildingEntityCount; i++) {
      const e = game.entities[i];
      if (!e || e.isAirUnit) continue;
      pushEntity(e, 'pre');
    }
    for (const s of game.structures) {
      rows.push({ logic, phase: 'structure', type: s.type, house: s.house, cell: `(${s.cx},${s.cy})`, mt: s.missionTimer });
      logic++;
    }
    for (let i = game._preBuildingEntityCount; i < game.entities.length; i++) {
      const e = game.entities[i];
      if (!e || e.isAirUnit) continue;
      pushEntity(e, 'post');
    }
    return rows;
  });

  await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });
  const wasmStep = await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(1);
    const result = r?.then ? await r : r;
    return result?.state ?? result;
  });
  await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  const tsLog = await tsPage.evaluate(() => (window as any).__rngTagControl('read').seedLog ?? []);

  const wasmFired = (wasmStep.rngLog ?? [])
    .map((entry: [number, number, number]) => entry[2] ?? entry[1])
    .filter((tag: number) => tag >= 10000 && tag < 13000)
    .map((tag: number) => wasmPre.find((r: any) => r.logic === tag % 10000) ?? { missing: tag });
  const tsFired = tsLog
    .map((entry: [number, number]) => entry[1])
    .filter((tag: number) => tag >= 10000 && tag < 13000)
    .map((tag: number) => tsPre.find((r: any) => r.logic === tag % 10000) ?? { missing: tag });

  console.log('WASM fired');
  for (const row of wasmFired) console.log(JSON.stringify(row));
  console.log('TS fired');
  for (const row of tsFired) console.log(JSON.stringify(row));
});
