/**
 * Phase 3c: SCG04EA unit[2] Commence trace Frame 22-27.
 *
 * Logs unit.cpp:404 pre/post pre-Commence, unit.cpp:496 pre/post post-DriveClass
 * Commence, unit.cpp:1795 pre/post Per_Cell_Process Commence. Expected ring
 * entries per unit[2] tick: up to 6 (9000000..9600000 + Frame).
 *
 * Confirms or refutes: at Frame 24, what triggers mq=MOVE pop in WASM vs TS?
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04EA unit[2] Commence trace F22-27', async ({ browser }) => {
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

  console.log('\n=== SCG04EA unit[2] Commence trace ===');
  console.log(`state.tick=${state.tick}`);
  const dm = state.debugMoves ?? [];
  console.log(`debugMoves entries: ${dm.length}`);

  const MISSIONS = ['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY',
    'ENTER','CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT',
    'UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE','HARMLESS'];
  const mname = (m: number) => (m < 0 ? '--' : (MISSIONS[m] ?? `?${m}`));

  const tagName = (tag: number, frame: number) => {
    const base = tag - frame;
    const map: Record<number, string> = {
      9000000: 'AI-entry:PRE404',
      9100000: 'AI-entry:POST404',
      9200000: 'AI-entry:POSTDrive',
      9300000: 'AI-entry:PRE496',
      9400000: 'AI-entry:POST496',
      9500000: 'PCP:PRE1795',
      9600000: 'PCP:POST1795',
    };
    return map[base] ?? `tag[${tag}]`;
  };

  for (const m of dm) {
    const [tag, a, b, c, d, e, f, g] = m;
    if (tag >= 9000000 && tag < 10000000) {
      const frame = tag % 1000;
      const label = tagName(tag, frame);
      console.log(`  F${String(frame).padStart(2)} ${label.padEnd(22)} Mission=${mname(b).padEnd(10)} mq=${mname(c).padEnd(6)} mt=${String(d).padStart(3)} drv=${e} gate/why=${f}`);
    }
  }

  await ctx.close();
});
