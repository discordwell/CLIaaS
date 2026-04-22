/**
 * Trace mmth1 team state WASM vs TS tick-by-tick for SCG11EA.
 * mmth1 = 4TNK:2, origin=-1 — different behavior from SCG07EA subz.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG11EA mmth1 WASM vs TS trace', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wp = await wasmCtx.newPage();
  const tp = await tsCtx.newPage();
  wp.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wp.goto(`${BASE_URL}/ra/original.html?scenario=SCG11EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tp.goto(`${BASE_URL}?anttest=agent&scenario=SCG11EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wp.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wp.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
  });
  await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let tick = 1; tick <= 5; tick++) {
    const [wRes, _] = await Promise.all([
      wp.evaluate(async () => {
        const r = (window as any).__agentStep(1);
        const res = r?.then ? await r : r;
        const s = res?.state ?? res;
        const teams = (s.teams ?? []) as Array<any>;
        return teams.filter((t: any) => t.cls === 'mmth1').map((t: any) => ({
          cls: t.cls, total: t.total, desired: t.desired,
          fs: t.fs, us: t.us, mv: t.mv, hb: t.hb, alt: t.alt,
          members: t.members,
        }));
      }),
      tp.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const tRes = await tp.evaluate(() => {
      const teams = ((window as any).__rawTeams?.() ?? []) as Array<any>;
      return teams.filter((t: any) => t.desiredMembers.some((m: any) => m.type === '4TNK')).map((t: any) => ({
        total: t.total,
        desired: t.desiredTotal,
        fs: t.isFullStrength,
        us: t.isUnderStrength,
        mv: t.isMoving,
        hb: t.isHasBeen,
        alt: t.isAltered,
        members: t.members.map((m: any) => ({ id: m.id, type: m.type, alive: m.alive })),
      }));
    });
    console.log(`tick ${tick}:`);
    console.log(`  WASM:`, JSON.stringify(wRes));
    console.log(`  TS:  `, JSON.stringify(tRes));
  }

  await wasmCtx.close();
  await tsCtx.close();
});
