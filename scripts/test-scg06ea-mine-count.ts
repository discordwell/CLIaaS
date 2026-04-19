import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG06EA mine count', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => { if (m.text().includes('MINE-COUNT')) logs.push(m.text()); });
  await page.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  console.log(`=== MINE-COUNT logs (${logs.length}) ===`);
  for (const l of logs) console.log(l);
  await ctx.close();
});
