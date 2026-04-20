import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG06EA BadGuy mission trace', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => { if (m.text().includes('BADGUY-MISSION')) logs.push(m.text()); });
  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  for (let t = 0; t < 10; t++) { await page.evaluate(() => { (window as any).__agentStep?.(1); }); }
  console.log(`=== BADGUY-MISSION logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);
  await ctx.close();
});
