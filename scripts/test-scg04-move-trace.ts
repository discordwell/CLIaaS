/**
 * SCG04 tick 3 Mission_Move over-fire trace.
 * Enables __traceMoveFires and runs the scenario to capture console.log output.
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG04 tick 3 move-fire trace', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();

  const logs: string[] = [];
  page.on('console', m => {
    const text = m.text();
    if (text.includes('[MOVE_FIRE]') || text.includes('[GUARD_FIRE]') || text.includes('[RNG]') || text.includes('[RNG.next]')) logs.push(text);
  });

  await page.goto(`${BASE}/?anttest=agent&scenario=SCG04EA&difficulty=normal`, {
    waitUntil: 'load',
  });
  await page.waitForFunction(() => (window as any).__agentReady === true, {
    timeout: 120_000, polling: 1000,
  });

  // Sync seed from WASM's canonical scenario RNG
  await page.evaluate(() => {
    (window as any).__syncRngSeed?.(0);
    (window as any).__traceMoveFires = true;
    (window as any).__traceAllRng = true;
  });

  // Step 5 ticks to cover tick 3
  for (let t = 1; t <= 5; t++) {
    await page.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  console.log('\n=== SCG04 t1-5 Mission_Move fire trace ===');
  for (const line of logs) console.log(line);
  console.log(`Total fires: ${logs.length}`);

  await ctx.close();
});
