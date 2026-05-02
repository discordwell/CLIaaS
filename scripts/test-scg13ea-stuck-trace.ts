/**
 * Trace TS USSR E1 (61,67) state every tick from start to find when it got stuck.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA stuck unit trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const tsPage = await tsCtx.newPage();

  await tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' });
  await tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  let prev = '';
  for (let t = 0; t < 105; t++) {
    if (t > 0) {
      await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
    }

    const state = await tsPage.evaluate(() => {
      const game = (window as any).__agentGame;
      if (!game) return null;
      // Track by id=109 (USSR E1 that ends up at (61,67))
      const e = game.entities.find((x: { alive: boolean; id: number }) => x.alive && x.id === 109);
      if (!e) return 'id=109 not alive';
      return JSON.stringify({
        c: `(${e.cell.cx},${e.cell.cy})`,
        m: e.mission, mt: e.missionTimer, mq: e.missionQueue,
        drv: e.isDriving, doing: e.doing, niat: e.nonInterruptAnimTicks,
        firing: e.isFiringAnim, pLen: e.path?.length,
        team: e.teamRef?.id ?? null,
      });
    });

    if (state !== prev) {
      console.log(`tick ${t}: ${state}`);
      prev = state;
    }
  }

  await tsCtx.close();
});
