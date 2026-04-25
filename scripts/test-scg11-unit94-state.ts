/**
 * SCG11EA tick 15 — capture unit[94]/[95] (mmth1 4TNK pair) full state in TS
 * to identify the 3-extra-RNG-per-tank source.
 *
 * From rng-entity-diff: TS fires 3 RNGs on unit[94] + 1 RNG on unit[95] from
 * `dispatchMission` body with raw layer tags (11094/11095). WASM fires 0.
 * Stack frames at column :367290 (vs Mission.GUARD's :369187) suggest the
 * MOVE/ATTACK/HUNT branches of dispatchMission. But STAGE B + STAGE F can
 * dispatch at most twice — 3 RNGs/tank is unaccounted for.
 *
 * This script dumps mmth1 team and unit[94]/[95] state at tick 14, 15, 16
 * to identify the divergence root cause.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG11EA mmth1 unit[94]/[95] state at tick 14-16', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();

  await p.goto(`${BASE_URL}/?anttest=agent&scenario=SCG11EA&difficulty=normal`, { waitUntil: 'load' });
  await p.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  // Step to tick 13
  await p.evaluate(async () => {
    const fn = (window as any).__agentStep;
    for (let i = 0; i < 13; i++) {
      const r = fn(1);
      if (r?.then) await r;
    }
  });

  // Capture state at ticks 14, 15, 16
  // Dump ALL entities (Phase 1 + Phase 3 — pre-building + post-building reinforcements).
  const logicEntities = await p.evaluate(() => {
    const game = (window as any).__agentGame;
    const ents = game?.entities ?? [];
    const cnt = game?._preBuildingEntityCount ?? ents.length;
    return {
      preCount: cnt,
      total: ents.length,
      all: ents.map((e: any, i: number) => ({
        idx: i, id: e.id, t: e.type, cx: e.cell?.cx, cy: e.cell?.cy,
        isAir: e.isAirUnit, isVess: e.stats?.isVessel, isInf: e.stats?.isInfantry,
        alive: e.alive,
      })),
    };
  });
  console.log(`\n=== Entities total=${logicEntities.total} preBuilding=${logicEntities.preCount} ===`);
  console.log(`Pre-building (logicIdx 0..${logicEntities.preCount-1}) count=${logicEntities.preCount}`);
  console.log(`Post-building reinforcements (idx ${logicEntities.preCount}..${logicEntities.total-1}) count=${logicEntities.total - logicEntities.preCount}`);
  console.log('Last 6 pre-building + first 6 post-building entities:');
  const start = Math.max(0, logicEntities.preCount - 6);
  const end = Math.min(logicEntities.total, logicEntities.preCount + 6);
  for (let i = start; i < end; i++) {
    const e = logicEntities.all[i];
    const phase = i < logicEntities.preCount ? 'PRE' : 'POST';
    console.log(`  ${phase} idx=${i} id=${e.id} type=${e.t} cell(${e.cx},${e.cy}) alive=${e.alive} isInf=${e.isInf} isVess=${e.isVess}`);
  }

  for (const tick of [14, 15, 16]) {
    const data = await p.evaluate(async () => {
      const fn = (window as any).__agentStep;
      const r = fn(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      const game = (window as any).__agentGame;
      const ents = game?.entities ?? [];
      // logicIdx 94/95 in WASM = MCV reinforcements (post-building phase).
      // In TS, these are entities at array index 46/47 (last 2 entries in entity list).
      const e94 = ents[46];
      const e95 = ents[47];
      return {
        tick: s.tick,
        e94: e94 ? {
          id: e94.id, type: e94.type, cx: e94.cell?.cx, cy: e94.cell?.cy,
          mission: e94.mission, missionQueue: e94.missionQueue, missionTimer: e94.missionTimer,
          isDriving: e94.isDriving, niat: e94.nonInterruptAnimTicks,
          path: e94.path?.length ?? 0, pathIndex: e94.pathIndex,
          moveTarget: e94.moveTarget ? `(${e94.moveTarget.lx},${e94.moveTarget.ly})` : null,
          target: e94.target ? `${e94.target.id}` : null,
        } : null,
        e95: e95 ? {
          id: e95.id, type: e95.type, cx: e95.cell?.cx, cy: e95.cell?.cy,
          mission: e95.mission, missionQueue: e95.missionQueue, missionTimer: e95.missionTimer,
          isDriving: e95.isDriving, niat: e95.nonInterruptAnimTicks,
          path: e95.path?.length ?? 0, pathIndex: e95.pathIndex,
          moveTarget: e95.moveTarget ? `(${e95.moveTarget.lx},${e95.moveTarget.ly})` : null,
          target: e95.target ? `${e95.target.id}` : null,
        } : null,
      };
    });
    console.log(`\n=== TICK ${data.tick} ===`);
    console.log(`logicIdx=94: ${JSON.stringify(data.e94)}`);
    console.log(`logicIdx=95: ${JSON.stringify(data.e95)}`);
  }
});
