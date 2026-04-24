/**
 * Phase 3a: SCG07EA vessel door-state trace.
 *
 * Runs SCG07EA to tick 8 and dumps WASM's agent_debug_log ring buffer.
 * Expected entries:
 *   [8100000+Frame, vesselID, Mission, MQ, IsDriving, IsDoorClosed, DoorShutCountDown, gateFires]
 *   [8200000+Frame, ...]  (post-DriveClass Commence)
 *
 * Confirms or refutes the hypothesis that LSTs spawn with door OPEN vs CLOSED
 * in C++, and identifies which vessels actually fire Commence at which ticks.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG07EA vessel door-state trace 0-8', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', async d => { await d.accept(); });

  const bust = Date.now();
  await page.goto(`${BASE}/ra/original.html?scenario=SCG07EA.INI&autoplay=1&agentharness=1&seed=0&cb=${bust}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  const state = await page.evaluate(async () => {
    const r = (window as any).__agentStep(8);
    const res = r?.then ? await r : r;
    return res?.state ?? res;
  });

  console.log('\n=== SCG07EA vessel door-state trace ===');
  console.log(`state.tick=${state.tick}, vessels.length=${state.vessels?.length ?? 0}`);
  const dm = state.debugMoves ?? [];
  console.log(`debugMoves entries: ${dm.length}`);

  const MISSIONS = ['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY',
    'ENTER','CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT',
    'UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE','HARMLESS'];
  const mname = (m: number) => (m < 0 ? '--' : (MISSIONS[m] ?? `?${m}`));

  for (const m of dm) {
    const [tag, a, b, c, d, e, f, g] = m;
    if (tag >= 8100000 && tag < 8300000) {
      const frame = tag % 1000;
      const phase = tag >= 8200000 ? 'POST' : 'PRE ';
      console.log(`  F${String(frame).padStart(2)} ${phase} vessel[${a}] Mission=${mname(b).padEnd(10)} mq=${mname(c).padEnd(6)} drv=${d} doorClosed=${e} doorShut=${String(f).padStart(3)} gateFires=${g}`);
    } else {
      console.log(`  ${JSON.stringify(m)}`);
    }
  }

  await ctx.close();
});
