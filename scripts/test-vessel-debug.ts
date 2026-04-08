import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('vessel console debug', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', msg => { if (msg.text().includes('VESSEL_RNG')) logs.push(msg.text()); });
  await page.goto(`${BASE_URL}/ra/original.html?scenario=SCG07EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180000, polling: 2000 });
  // Step 5 ticks
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
  }
  console.log(`=== VESSEL_RNG console messages (${logs.length}) ===`);
  for (const l of logs) console.log(l);
  await ctx.close();
});
