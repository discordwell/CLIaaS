/**
 * SCG01EA building[57] state at tick 77 — investigate Repair_AI divergence.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG01EA building[57] state at tick 76, 77', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();

  await p.goto(`${BASE_URL}/?anttest=agent&scenario=SCG01EA&difficulty=normal`, { waitUntil: 'load' });
  await p.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  await p.evaluate(async () => {
    const fn = (window as any).__agentStep;
    for (let i = 0; i < 75; i++) {
      const r = fn(1);
      if (r?.then) await r;
    }
  });

  for (const tick of [76, 77]) {
    const data = await p.evaluate(async () => {
      const fn = (window as any).__agentStep;
      const r = fn(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      const game = (window as any).__agentGame;
      // building[57] in WASM = TS structure at structIdx 57 - preBuildingCount.
      // Need to identify which TS structure that maps to.
      const structs = game?.structures ?? [];
      const damaged = structs
        .filter((b: any) => b.alive && b.hp < b.maxHp)
        .map((b: any) => ({
          house: b.house, type: b.type, cx: b.cx, cy: b.cy,
          hp: b.hp, maxHp: b.maxHp, isToRepair: b.isToRepair,
          isRepairing: b.isRepairing, missionTimer: b.missionTimer,
        }))
        .slice(0, 30);
      return {
        tick: s.tick,
        rngLogLen: s.rngLog?.length ?? 0,
        damaged,
        structureCount: structs.length,
      };
    });
    console.log(`\n=== TICK ${data.tick} ===`);
    console.log(`Total structures: ${data.structureCount}, damaged: ${data.damaged.length}`);
    for (const b of data.damaged) {
      console.log(`  ${b.type}@(${b.cx},${b.cy}) house=${b.house} hp=${b.hp}/${b.maxHp} isToRepair=${b.isToRepair} isRepairing=${b.isRepairing} mt=${b.missionTimer}`);
    }
  }
});
