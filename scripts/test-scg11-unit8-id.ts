/**
 * Phase 3f: Identify SCG11EA TS logic index 8 entity and WASM equivalent at tick 19.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG11EA logic position 8 identification', async ({ browser }) => {
  test.setTimeout(180_000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wp.goto(`${BASE}/ra/original.html?scenario=SCG11EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tp.goto(`${BASE}/?anttest=agent&scenario=SCG11EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wp.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
    tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wSeed = await wp.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wSeed);

  // Step to tick 19
  await Promise.all([
    wp.evaluate(async () => { const r = (window as any).__agentStep(19); if (r?.then) await r; }),
    tp.evaluate(() => { (window as any).__agentStep?.(19); }),
  ]);

  // TS entity list in logic order (pre-building phase)
  const tsEntities = await tp.evaluate(() => {
    const g = (window as any).__agentGame;
    if (!g) return [];
    const preCount = g._preBuildingEntityCount ?? g.entities.length;
    return g.entities.slice(0, preCount).filter((e: any) => e.alive && !e.isAirUnit).map((e: any, i: number) => ({
      logicIdx: i, id: e.id, type: String(e.type ?? ''),
      cx: e.cell?.cx, cy: e.cell?.cy,
      mission: e.mission, mq: e.missionQueue,
      drv: e.isDriving, mt: e.missionTimer,
    }));
  });
  const MISSIONS = ['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY','ENTER','CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT','UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE','HARMLESS'];

  console.log('\n=== TS entities in logic order (pre-building, ground) ===');
  for (const e of tsEntities.slice(0, 20)) {
    console.log(`  [${String(e.logicIdx).padStart(2)}] ${e.type.padEnd(5)} id=${String(e.id).padStart(4)} cell=(${e.cx},${e.cy}) m=${(MISSIONS[e.mission]??'?').padEnd(10)} mq=${e.mq<0?'--':(MISSIONS[e.mq]??'?').padEnd(5)} mt=${e.mt} drv=${e.drv}`);
  }

  // WASM units list
  const wasmState = await wp.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return {
      units: s.units ?? [], infantry: s.infantry ?? [], vessels: s.vessels ?? [],
      enemies: s.enemies ?? [], aircraft: s.aircraft ?? [], neutrals: s.neutrals ?? [],
    };
  });
  console.log('\n=== WASM units (Units heap) — first 20 ===');
  const all = wasmState.units.concat(wasmState.enemies, wasmState.neutrals);
  for (let i = 0; i < Math.min(all.length, 20); i++) {
    const u = all[i];
    console.log(`  [${String(i).padStart(2)}] ${(u.t??'?').padEnd(5)} cell=(${u.cx},${u.cy}) m=${(MISSIONS[u.m??0]??'?').padEnd(10)} mq=${(u.mq??-1)<0?'--':(MISSIONS[u.mq]??'?').padEnd(5)} mt=${u.mt??0} drv=${u.drv?'T':'F'} h=${u.h??'?'}`);
  }

  await wCtx.close(); await tCtx.close();
});
