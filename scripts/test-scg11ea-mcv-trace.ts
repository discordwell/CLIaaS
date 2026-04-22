/**
 * SCG11EA tick-by-tick MCV position trace — WASM only.
 * Dumps Coord_X, Coord_Y, Mission, MissionTimer, IsDriving, MissionQueue
 * for the two Greece MCVs at each tick 1..35 to understand WHEN cell
 * boundaries are crossed and WHEN Mission_Move fires.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG11EA MCV per-tick coord trace', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  await page.goto(
    `${BASE_URL}/ra/original.html?scenario=SCG11EA.INI&autoplay=1&agentharness=1&seed=0`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(() => {
    try {
      const M = (window as any).Module;
      return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
    } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  console.log('\ntick | MCV-156 (west)                              | MCV-157 (east)');
  console.log('     | lx     ly     cell    m  mt drv  mq  nav   | lx     ly     cell    m  mt drv  mq  nav');
  console.log('-----+---------------------------------------------+---------------------------------------------');

  for (let tick = 1; tick <= 35; tick++) {
    const state = await page.evaluate(() => {
      const M = (window as any).Module;
      const r = (window as any).__agentStep(1);
      return r?.then ? r.then(() => JSON.parse(M.ccall('agent_get_state', 'string', [], []))) :
        JSON.parse(M.ccall('agent_get_state', 'string', [], []));
    });
    const units = state.units || [];
    const mcvs = units.filter((u: any) => u.t === 'MCV').sort((a: any, b: any) => a.cx - b.cx);

    const fmt = (u: any) => {
      if (!u) return '(missing)'.padEnd(45);
      const nav = (u.nlx !== undefined) ? `${u.nlx},${u.nly}` : '-';
      return `${String(u.lx).padStart(6)} ${String(u.ly).padStart(6)} (${u.cx},${u.cy})  ${u.m}  ${String(u.mt).padStart(2)} ${u.drv?'T':'F'}    ${u.mq}   ${nav.padEnd(11)}`;
    };
    console.log(`${String(tick).padStart(4)} | ${fmt(mcvs[0])} | ${fmt(mcvs[1])}`);
  }

  await ctx.close();
});
