import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG06EA WASM logic dump', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => { if (m.text().includes('LOGIC-TICK0')) logs.push(m.text()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step 1 tick
  await page.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });

  console.log(`=== LOGIC-TICK0 logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);

  await ctx.close();
});
