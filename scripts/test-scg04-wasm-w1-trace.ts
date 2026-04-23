/**
 * Session 16: fetch WASM's agent_debug_log after running SCG04EA to tick 3.
 * The instrumented unit.cpp logs (Frame, ID, Mission, MissionQueue, Timer,
 * IsDriving, IsDumping, Is_Door_Closed) at UnitClass::AI entry for the
 * 3TNK at cell (39,34) when Frame==3.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04 W1 tick-3 UnitClass::AI entry trace', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  const bust = Date.now();
  await page.goto(`${BASE}/ra/original.html?scenario=SCG04EA.INI&autoplay=1&agentharness=1&seed=0&cb=${bust}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step to tick 3 in a single call so debugMoves isn't reset between
  const state = await page.evaluate(async () => {
    const r = (window as any).__agentStep(3);
    const res = r?.then ? await r : r;
    return res?.state ?? res;
  });

  console.log('\n=== SCG04 W[1] tick-3 UnitClass::AI entry trace ===');
  const dm = state.debugMoves ?? [];
  console.log(`debugMoves entries: ${dm.length}`);
  for (const m of dm) {
    console.log(`  ${JSON.stringify(m)}`);
  }

  await ctx.close();
});
