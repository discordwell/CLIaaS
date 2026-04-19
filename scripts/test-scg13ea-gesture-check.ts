import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG13EA gesture check', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => { if (m.text().includes('TEAM-GESTURE')) logs.push(m.text()); });

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

  for (let t = 0; t < 100; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  console.log(`=== Gesture logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);

  // Also dump ent109 nonInterruptAnimTicks at ticks 93-101
  const state = await page.evaluate(() => {
    const game = (window as any).__agentGame;
    const e = game.entities.find((ent: { id: number }) => ent.id === 109);
    return {
      niat: e?.nonInterruptAnimTicks,
      doing: e?.doing,
      missionQueue: e?.missionQueue,
    };
  });
  console.log(`Ent109 state at tick 100: ${JSON.stringify(state)}`);

  await ctx.close();
});
