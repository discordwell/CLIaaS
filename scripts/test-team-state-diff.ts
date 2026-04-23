/**
 * Per-team state diff (WASM vs TS). Shows team activation / member composition
 * per tick so we can see WHEN each scenario team activates and what it recruits.
 *
 * Usage:
 *   SCENARIO=SCG04EA MAX=10 npx playwright test scripts/test-team-state-diff.ts
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE = process.env.TS_BASE_URL ?? BASE;
const SCENARIO = process.env.SCENARIO ?? 'SCG04EA';
const MAX = Number(process.env.MAX ?? 5);

test(`${SCENARIO} per-team state diff ticks 0-${MAX}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wp.goto(`${BASE}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tp.goto(`${TS_BASE}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wp.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
    tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wSeed = await wp.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wSeed);

  const collectW = async (page: any) => page.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    return s.teams ?? [];
  });

  const collectT = async (page: any) => page.evaluate(() => {
    const fn = (window as any).__teamsList;
    if (typeof fn !== 'function') return [];
    const teams = fn();
    return (teams ?? []).map((t: any) => ({
      i: t.id ?? -1,
      cls: t.name ?? t.teamTypeName ?? '?',
      house: String(t.house ?? '?'),
      total: (t._members ?? []).length,
      desired: (t.desiredMembers ?? []).reduce((sum: number, m: any) => sum + (m.count ?? 0), 0),
      fs: !!t.isFullStrength,
      us: !!t.isUnderStrength,
      fa: !!t.isForcedActive,
      mv: !!t.isMoving,
      hb: !!t.isHasBeen,
      rf: !!t.isReforming,
      members: (t._members ?? []).map((m: any) => m.id ?? -1),
    }));
  });

  console.log(`\n=== ${SCENARIO} team state diff ===`);

  for (let t = 1; t <= MAX; t++) {
    await Promise.all([
      wp.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tp.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const [wTeams, tTeams] = await Promise.all([collectW(wp), collectT(tp)]);
    console.log(`--- tick ${t} ---`);
    console.log(`  WASM teams (${wTeams.length}):`);
    for (const tm of wTeams) {
      const mem = (tm.members ?? []).map((m: any) => m.ids ?? []).flat().join(',');
      console.log(`    [${tm.i}] ${tm.cls} ${tm.house} total=${tm.total}/${tm.desired} fs=${tm.fs} mv=${tm.mv} hb=${tm.hb} rf=${tm.rf} ids=${mem}`);
    }
    console.log(`  TS   teams (${tTeams.length}):`);
    for (const tm of tTeams) {
      console.log(`    [${tm.i}] ${tm.cls} ${tm.house} total=${tm.total}/${tm.desired} fs=${tm.fs} mv=${tm.mv} hb=${tm.hb} rf=${tm.rf} ids=${(tm.members ?? []).join(',')}`);
    }
  }
  await wCtx.close(); await tCtx.close();
});
