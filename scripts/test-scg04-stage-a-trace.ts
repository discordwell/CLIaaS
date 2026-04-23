/**
 * SCG04 STAGE A pop trace — identifies which TS units pop MissionQueue
 * when in tick 1-5, to compare with WASM's Commence pop tick.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04 STAGE A pop trace t1-5', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', m => {
    const text = m.text();
    if (text.includes('[STAGE_A_POP]')) logs.push(text);
  });

  await page.goto(`${BASE}/?anttest=agent&scenario=SCG04EA&difficulty=normal`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  await page.evaluate(() => {
    (window as any).__syncRngSeed?.(0);
    (window as any).__traceStageA = true;
  });

  for (let t = 1; t <= 5; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }
  console.log('\n=== SCG04 STAGE A pops (t1-5) ===');
  for (const l of logs) console.log(l);
  console.log(`Total pops: ${logs.length}`);
  await ctx.close();
});
