/**
 * Capture ENT109-MISSION console logs to identify what code path sets mission=MOVE
 * for E1 USSR at (61,67) during SCG13EA tick 94.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA ent[109] mission setter stack', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', msg => { if (msg.text().includes('ENT109-MISSION')) logs.push(msg.text()); });

  // Sync WASM seed
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

  for (let t = 0; t < 105; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  console.log(`=== ENT109-MISSION transitions (${logs.length}) ===`);
  for (const l of logs) console.log(l);

  await ctx.close();
});
