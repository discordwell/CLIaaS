/**
 * SCG04EA tick 3 — capture state of all 3TNK tanks.
 * WASM fires Mission_Move_foot for unit[73] (3TNK BadGuy at cell 42,35).
 * TS doesn't fire it — the eager isDriving=true flip blocks Commence pop.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04EA 3TNK state at ticks 1, 2, 3, 4', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();

  await p.goto(`${BASE_URL}/?anttest=agent&scenario=SCG04EA&difficulty=normal`, { waitUntil: 'load' });
  await p.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  for (const tick of [1, 2, 3, 4]) {
    const data = await p.evaluate(async () => {
      const fn = (window as any).__agentStep;
      const r = fn(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      const game = (window as any).__agentGame;
      const ents = game?.entities ?? [];
      const teams = (window as any).__teamsList?.() ?? [];
      const tanks = ents
        .map((e: any, idx: number) => ({ idx, e }))
        .filter(({ e }: any) => e.alive && e.type === '3TNK')
        .map(({ idx, e }: any) => ({
          idx, id: e.id, type: e.type, cx: e.cell?.cx, cy: e.cell?.cy,
          mission: e.mission, mq: e.missionQueue, mt: e.missionTimer,
          isDriving: e.isDriving, niat: e.nonInterruptAnimTicks,
          path: e.path?.length ?? 0, pathIdx: e.pathIndex,
          target: e.target?.id ?? null,
          moveTarget: e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : null,
          house: e.house, facing: e.facing,
        }));
      return {
        tick: s.tick,
        rngLogLen: s.rngLog?.length ?? 0,
        rngLog: s.rngLog,
        tanks,
        teams: teams.map((t: any) => ({
          id: t.id, members: (t._members ?? []).map((m: any) => `${m.id}:${m.type}`).join(','),
          mission: t.currentMission, isMoving: t.isMoving,
        })),
      };
    });
    console.log(`\n=== TICK ${data.tick} (rng calls: ${data.rngLogLen}) ===`);
    console.log(`Teams (${data.teams.length}):`);
    for (const t of data.teams) {
      console.log(`  team#${t.id} mission=${t.mission} isMoving=${t.isMoving} mem=[${t.members}]`);
    }
    console.log(`3TNK tanks (${data.tanks.length}):`);
    for (const t of data.tanks) {
      console.log(`  idx=${t.idx} id=${t.id} h=${t.house} cell(${t.cx},${t.cy}) m=${t.mission} mq=${t.mq} mt=${t.mt} drv=${t.isDriving} niat=${t.niat} path=${t.path}/${t.pathIdx} fac=${t.facing} mv=${t.moveTarget}`);
    }
  }
});
