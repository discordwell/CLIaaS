/**
 * RNG caller trace — shows which TS function consumed each RNG call on a specific tick.
 * Reads _taggedLog which captures stack frame info.
 * Usage: SCENARIO=SCG04EA TICK=2 npx playwright test scripts/test-rng-caller-trace.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG04EA';
const targetTick = Number(process.env.TICK ?? 2);

test(`${scenario} RNG caller trace tick ${targetTick}`, async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
  ]);

  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

  // Step to targetTick-1 without tag tracking
  for (let t = 0; t < targetTick; t++) {
    await wasmPage.evaluate(async () => {
      const r = (window as any).__agentStep(1);
      return r?.then ? await r : r;
    });
    await tsPage.evaluate(() => { (window as any).__rngTagControl?.('reset'); });
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  }

  // Reset tag log, then step 1 tick with tracking
  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('reset'); });
  const wasmResult = await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(1);
    const result = r?.then ? await r : r;
    const s = result?.state ?? result;
    return { rngLog: s.rngLog ?? [] };
  });
  await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  const tsLog = await tsPage.evaluate(() => (window as any).__rngTagControl?.('read'));

  console.log(`\n=== Tick ${targetTick} ===\n`);
  console.log(`WASM rngLog (${wasmResult.rngLog.length} entries):`);
  for (const [seed, tag] of wasmResult.rngLog) {
    console.log(`  [tag=${tag}] seed=${seed}`);
  }

  console.log(`\nTS seedLog (${tsLog?.seedLog?.length ?? 0} entries):`);
  for (let i = 0; i < tsLog.seedLog.length; i++) {
    const [seed, tag] = tsLog.seedLog[i];
    const caller = tsLog.taggedLog[i];
    console.log(`  [tag=${tag}] seed=${seed}  caller=${caller}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
