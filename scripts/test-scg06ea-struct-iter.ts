import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG06EA struct iter trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => { if (m.text().includes('STRUCT-TICK')) logs.push(m.text()); });

  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });

  // Step 1 tick
  await page.evaluate(() => { (window as any).__agentStep?.(1); });

  console.log(`=== Struct iter logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);

  await ctx.close();
});
