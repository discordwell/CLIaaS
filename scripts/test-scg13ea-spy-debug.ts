/**
 * Capture T43-SPY console logs from TS engine at cell (9,53).
 * Prints what isReadyToRandomAnimate() returns and why.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA SPY isReady debug', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('T43-SPY') || t.includes('[SPY')) logs.push(t);
  });

  // WASM context for seed sync
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await wasmCtx.close();

  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  await page.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let t = 0; t < 44; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  console.log(`=== TS T43-SPY logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);

  // Also dump SPY state from TS directly
  const spyState = await page.evaluate(() => {
    const game = (window as any).__agentGame;
    if (!game) return null;
    const spy = game.entities.find((e: { type: string; cell: { cx: number; cy: number } }) =>
      e.type === 'SPY' && e.cell.cx === 9 && e.cell.cy === 53);
    if (!spy) return null;
    return {
      id: spy.id, type: spy.type, house: spy.house,
      cx: spy.cell.cx, cy: spy.cell.cy,
      mission: spy.mission, mt: spy.missionTimer,
      doing: spy.doing, idle: spy.idleAnimTimer,
      firing: spy.isFiringAnim, prone: spy.isProne, driving: spy.isDriving,
      isInf: spy.stats?.isInfantry, weapon: spy.weapon?.name ?? null,
      target: spy.target ? `${spy.target.type}@${spy.target.cell?.cx},${spy.target.cell?.cy}` : null,
      arm: spy.attackCooldown,
    };
  });
  console.log(`=== TS SPY state at tick 44 start: ${JSON.stringify(spyState)}`);

  await ctx.close();
});
