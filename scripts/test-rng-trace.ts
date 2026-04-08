/**
 * RNG call trace — step tick-by-tick and compare WASM rngLog vs TS seedLog
 * Usage: SCENARIO=SCG07EA npx playwright test scripts/test-rng-trace.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG07EA';
const startTick = Number(process.env.START ?? 2);
const endTick = Number(process.env.END ?? 5);

test(`${scenario} RNG trace ticks ${startTick}-${endTick}`, async ({ browser }) => {
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

  // Sync RNG
  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // Enable tag logging on TS
  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

  // Step tick by tick — read rngLog from agent_step RETURN value (not separate get_state)
  for (let tick = startTick; tick <= endTick; tick++) {
    // Reset TS tag log
    await tsPage.evaluate(() => { (window as any).__rngTagControl?.('reset'); });

    // Step WASM 1 tick — rngLog is included in the step return (agent_step calls agent_get_state internally)
    const wasmResult = await wasmPage.evaluate(async () => {
      const r = (window as any).__agentStep(1);
      const result = r?.then ? await r : r;
      if (result?.error) return { tick: 0, rngState: 0, rngCalls: 0, rngLog: [], error: result.error };
      const s = result?.state ?? result;
      return {
        tick: s.tick, rngState: s.rngState, rngCalls: s.rngCalls,
        rngLog: s.rngLog ?? [],
      };
    });

    // Step TS 1 tick — capture before/after callCount to detect actual RNG consumption
    const tsBefore = await tsPage.evaluate(() => ({
      tick: ((window as any).__agentGame as any)?.tick ?? -1,
      seed: (window as any).__agentGame ? 0 : -1, // placeholder
      calls: (window as any).__agentState?.()?.rngCalls ?? -1,
    }));
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
    const tsAfter = await tsPage.evaluate(() => ({
      tick: ((window as any).__agentGame as any)?.tick ?? -1,
      calls: (window as any).__agentState?.()?.rngCalls ?? -1,
    }));
    console.log(`  TS step: tick ${tsBefore.tick}→${tsAfter.tick}, calls ${tsBefore.calls}→${tsAfter.calls} (delta=${tsAfter.calls - tsBefore.calls})`);

    // Read TS tag log
    const tsLog = await tsPage.evaluate(() => (window as any).__rngTagControl?.('read'));
    const tsState = await tsPage.evaluate(() => {
      const s = (window as any).__agentState();
      return { tick: s.tick, rngState: s.rngState, rngCalls: s.rngCalls };
    });

    console.log(`\n=== Tick ${tick} ===`);
    console.log(`WASM: seed=${wasmResult.rngState} calls=${wasmResult.rngCalls} log=${wasmResult.rngLog.length} entries`);
    console.log(`TS:   seed=${tsState.rngState} calls=${tsState.rngCalls} log=${tsLog?.seedLog?.length ?? 0} entries`);

    if (wasmResult.rngLog.length > 0) {
      console.log(`WASM rngLog:`);
      for (const [seed, tag] of wasmResult.rngLog) {
        let category: string;
        if (tag >= 10000 && tag < 11000) category = `infantry[${tag-10000}]`;
        else if (tag >= 11000 && tag < 12000) category = `unit[${tag-11000}]`;
        else if (tag >= 12000 && tag < 13000) category = `building[${tag-12000}]`;
        else if (tag >= 13000 && tag < 14000) category = `aircraft[${tag-13000}]`;
        else if (tag >= 14000 && tag < 15000) category = `vessel[${tag-14000}]`;
        else if (tag >= 100 && tag < 200) category = `houseAI[${tag}]`;
        else category = `other[${tag}]`;
        console.log(`  [${tag}] ${category} seed=${seed}`);
      }
    }

    if (tsLog?.seedLog?.length > 0) {
      console.log(`TS seedLog:`);
      for (const [seed, tag] of tsLog.seedLog) {
        let category: string;
        if (tag >= 10000 && tag < 11000) category = `infantry[${tag-10000}]`;
        else if (tag >= 11000 && tag < 12000) category = `unit[${tag-11000}]`;
        else if (tag >= 12000 && tag < 13000) category = `building[${tag-12000}]`;
        else if (tag >= 13000 && tag < 14000) category = `aircraft[${tag-13000}]`;
        else category = `other[${tag}]`;
        console.log(`  [${tag}] ${category} seed=${seed}`);
      }
    }

    // Compare seed-by-seed if both have entries
    if (wasmResult.rngLog.length > 0 && tsLog?.seedLog?.length > 0) {
      const maxLen = Math.max(wasmResult.rngLog.length, tsLog.seedLog.length);
      let firstDiff = -1;
      for (let i = 0; i < maxLen; i++) {
        const ws = wasmResult.rngLog[i]?.[0] ?? 'none';
        const ts = tsLog.seedLog[i]?.[0] ?? 'none';
        if (ws !== ts && firstDiff === -1) firstDiff = i;
      }
      if (firstDiff >= 0) {
        console.log(`First seed divergence at index ${firstDiff}: WASM=${wasmResult.rngLog[firstDiff]?.[0]} TS=${tsLog.seedLog[firstDiff]?.[0]}`);
      } else {
        console.log(`All ${Math.min(wasmResult.rngLog.length, tsLog.seedLog.length)} seeds match!`);
      }
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
