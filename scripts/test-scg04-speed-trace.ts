/**
 * Phase 3d: SCG04EA unit[2] speed accumulator trace Frame 22-27.
 *
 * Logs drive.cpp:681-685 actual computation (SpeedAccum + maxspeed * fixed(Speed, 256))
 * and drive.cpp:832 post-loop SpeedAccum. Tag 10000000+Frame, 10100000+Frame.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04EA unit[2] speed trace F22-27', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  const bust = Date.now();
  await page.goto(`${BASE}/ra/original.html?scenario=SCG04EA.INI&autoplay=1&agentharness=1&seed=0&cb=${bust}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  const state = await page.evaluate(async () => {
    const r = (window as any).__agentStep(28);
    const res = r?.then ? await r : r;
    return res?.state ?? res;
  });

  console.log('\n=== SCG04EA unit[2] speed trace ===');
  const dm = state.debugMoves ?? [];
  console.log(`debugMoves entries: ${dm.length}`);

  for (const m of dm) {
    const [tag, uid, a, b, c, d, e, f] = m;
    if (tag >= 10000000 && tag < 10100000) {
      const frame = tag % 1000;
      console.log(`  F${frame} ENTRY unit[${uid}]  SpeedAccum=${a}  actual=${b}  maxspeed=${c}  Speed=${d}  MaxSpeedType=${e}`);
    } else if (tag >= 10100000 && tag < 10200000) {
      const frame = tag % 1000;
      console.log(`  F${frame} EXIT  unit[${uid}]  SpeedAccum=${a}  TrackIdx=${b}  TrackNum=${c}  IsDriving=${d}`);
    }
  }

  await ctx.close();
});
