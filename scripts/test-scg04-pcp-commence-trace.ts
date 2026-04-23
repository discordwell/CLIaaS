/**
 * Session 10: Log MissionClass::Commence calls inside UnitClass::Per_Cell_Process
 * for SCG04EA ticks 22-27 to verify whether drive-in-GUARD → MOVE pop
 * fires during W[1]'s cell traversal (40,34) → (41,35).
 *
 * WASM side has agent_debug_log with tag 5000000+Frame emitted at the
 * unit.cpp:1778 Commence call site inside Per_Cell_Process.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04 PCP Commence trace ticks 22-27', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  const bust = Date.now();
  await page.goto(`${BASE}/ra/original.html?scenario=SCG04EA.INI&autoplay=1&agentharness=1&seed=0&cb=${bust}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step to tick 27 in a single call so debugMoves aren't reset between
  const state = await page.evaluate(async () => {
    const r = (window as any).__agentStep(27);
    const res = r?.then ? await r : r;
    return res?.state ?? res;
  });

  console.log('\n=== SCG04 PCP Commence trace (t22-27) ===');
  console.log(`state.tick=${state.tick}, units.length=${state.units?.length}`);
  const dm = state.debugMoves ?? [];
  console.log(`debugMoves entries: ${dm.length}`);
  for (const m of dm) {
    console.log(`  ${JSON.stringify(m)}`);
  }

  await ctx.close();
});
