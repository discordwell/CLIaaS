/**
 * Compare PATROL team members at tick 113 (just before scan fires at TS tick 113).
 * Find why TS fires 4 Mission_Guard at tick 114 vs WASM 1.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;

test('SCG13EA t113-114 PATROL members', async ({ browser }) => {
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

  for (let t = 0; t < 112; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  for (let t = 112; t <= 115; t++) {
    if (t > 112) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }

    // WASM: PATROL team members (USSR E1 with team!=null, mission GUARD or MOVE)
    const wasmMembers = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      // Get nptrl + kptrl team member IDs
      const teamMemberIds = new Set<number>();
      for (const t of (s.teams ?? [])) {
        if (t.cls === 'nptrl' || t.cls === 'kptrl') {
          for (const mt of (t.members ?? [])) {
            for (const id of (mt.ids ?? [])) teamMemberIds.add(id);
          }
        }
      }
      return all
        .filter((u: { id: number; t: string }) => teamMemberIds.has(u.id) && u.t === 'E1')
        .map((u: { id: number; cx: number; cy: number; lx: number; ly: number; m: number; mt: number; mq: number; drv: boolean; nlx?: number; nly?: number; hlx?: number; hly?: number; doing: number; p0?: number; spd?: number }) =>
          ({ id: u.id, c: `(${u.cx},${u.cy})`, pos: `(${u.lx},${u.ly})`, m: u.m, mt: u.mt, mq: u.mq, drv: u.drv,
             head: u.hlx !== undefined ? `(${u.hlx},${u.hly})` : null,
             nav: u.nlx !== undefined ? `(${u.nlx},${u.nly})` : null, doing: u.doing, p0: u.p0, spd: u.spd }));
    });

    const tsMembers = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      return game.entities
        .filter((e: { alive: boolean; type: string; house: string; teamRef?: { id: number } }) =>
          e.alive && e.type === 'E1' && e.house === 'USSR' && e.teamRef != null)
        .map((e: { id: number; cell: { cx: number; cy: number }; leptonX: number; leptonY: number; mission: string; missionTimer: number; missionQueue: string | null; moveTarget: { lx: number; ly: number } | null; headToLX: number; headToLY: number; doing: string; teamRef?: { id: number }; isDriving: boolean; path: Array<{ cx: number; cy: number }>; pathIndex: number }) =>
          ({ id: e.id, c: `(${e.cell.cx},${e.cell.cy})`, pos: `(${e.leptonX},${e.leptonY})`, m: e.mission, mt: e.missionTimer, mq: e.missionQueue,
             head: e.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : null,
             nav: e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : null,
             doing: e.doing, drv: e.isDriving, team: e.teamRef?.id,
             path: `${e.pathIndex}/${e.path?.length ?? 0}` }));
    });

    console.log(`tick ${t}:`);
    console.log(`  WASM PATROL members:`);
    for (const u of wasmMembers) console.log(`    ${JSON.stringify(u)}`);
    console.log(`  TS PATROL members:`);
    for (const e of tsMembers ?? []) console.log(`    ${JSON.stringify(e)}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
