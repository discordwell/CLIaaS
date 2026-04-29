/**
 * SCG07EA tick 2 — capture all vessel state to identify why TS isn't firing
 * Mission_Move_foot for vessels[182-185] (logicIdx 182-185 in WASM = TS post-
 * building reinforcement vessels).
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG07EA vessel state at tick 1, 2, 3', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();

  await p.goto(`${BASE_URL}/?anttest=agent&scenario=SCG07EA&difficulty=normal`, { waitUntil: 'load' });
  await p.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  for (const _ of [0]) {
    void _;
    const layout = await p.evaluate(() => {
      const game = (window as any).__agentGame;
      const ents = game?.entities ?? [];
      const cnt = game?._preBuildingEntityCount ?? ents.length;
      const total = ents.length;
      return { preCount: cnt, total };
    });
    console.log(`Pre-building entity count: ${layout.preCount}, total: ${layout.total}`);
  }

  // Tick 0: dump vessel state right after init
  const t0 = await p.evaluate(() => {
    const game = (window as any).__agentGame;
    const ents = game?.entities ?? [];
    const teams = (window as any).__teamsList?.() ?? [];
    return {
      vessels: ents
        .map((e: any, idx: number) => ({ idx, e }))
        .filter(({ e }: any) => e.alive && e.stats?.isVessel)
        .map(({ idx, e }: any) => ({
          idx, id: e.id, type: e.type,
          mission: e.mission, mq: e.missionQueue,
          isDriving: e.isDriving, path: e.path?.length ?? 0,
        })),
      teams: teams.map((t: any) => ({
        id: t.id, members: (t._members ?? []).map((m: any) => `${m.id}:${m.type}`).join(','),
        mission: t.currentMission, isMoving: t.isMoving,
      })),
    };
  });
  console.log(`\n=== TICK 0 (post-init, pre-step) ===`);
  console.log(`Teams (${t0.teams.length}):`);
  for (const t of t0.teams) console.log(`  team#${t.id} miss=${t.mission} mv=${t.isMoving} mem=[${t.members}]`);
  console.log(`Vessels w/ Mission=MOVE or queue=MOVE:`);
  for (const v of t0.vessels.filter((x: any) => x.mq || x.mission === 'MOVE')) {
    console.log(`  idx=${v.idx} ${v.type} m=${v.mission} mq=${v.mq} drv=${v.isDriving} path=${v.path}`);
  }

  for (const tick of [1, 2, 3]) {
    const data = await p.evaluate(async () => {
      const fn = (window as any).__agentStep;
      const r = fn(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      const game = (window as any).__agentGame;
      const ents = game?.entities ?? [];
      // Dump all vessels (vessels are anywhere in the entity list)
      return {
        tick: s.tick,
        vessels: ents
          .map((e: any, idx: number) => ({ idx, e }))
          .filter(({ e }: any) => e.alive && e.stats?.isVessel)
          .map(({ idx, e }: any) => ({
            idx, id: e.id, type: e.type, cx: e.cell?.cx, cy: e.cell?.cy,
            mission: e.mission, mq: e.missionQueue, mt: e.missionTimer,
            isDriving: e.isDriving, niat: e.nonInterruptAnimTicks,
            doorOpen: e.doorOpen, doorTimer: e.doorTimer,
            path: e.path?.length ?? 0, pathIdx: e.pathIndex,
            isLoaner: e.isALoaner, isTransport: e.isTransport,
            commenceFired: e._commenceFiredThisTick,
          })),
      };
    });
    console.log(`\n=== TICK ${data.tick} (${data.vessels.length} vessels) ===`);
    for (const v of data.vessels) {
      console.log(
        `  idx=${v.idx} id=${v.id} ${v.type} cell(${v.cx},${v.cy}) m=${v.mission} mq=${v.mq} ` +
        `mt=${v.mt} drv=${v.isDriving} niat=${v.niat} door=${v.doorOpen}@${v.doorTimer} ` +
        `path=${v.path}/${v.pathIdx} loaner=${v.isLoaner} transp=${v.isTransport} cmCFTT=${v.commenceFired}`,
      );
    }
  }
});
