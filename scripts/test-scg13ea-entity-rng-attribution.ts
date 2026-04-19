/**
 * Task #43 deep-dive: attribute each RNG call at tick 43 to a specific entity
 * on BOTH sides, then find the entity WASM processes that TS skips.
 *
 * Uses new WASM triplet log format: [seed, source_tag, entity_tag].
 * entity_tag = 10000+heap_index for infantry, 11000+ for units, etc.
 * TS side uses _seedLog pairs [seed, source_tag] where source_tag is logicIdx-based.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA tick 43 per-entity RNG attribution', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' }),
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

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

  // Step to tick 42 end (42 steps, untracked)
  for (let t = 0; t < 42; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  // Reset logs, step 1 more tick with tracking
  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('reset'); });
  const wasmStepResult = await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(1);
    const result = r?.then ? await r : r;
    const s = result?.state ?? result;
    return { rngLog: s.rngLog ?? [] };
  });
  await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
  const tsLog = await tsPage.evaluate(() => (window as any).__rngTagControl?.('read'));

  // WASM log is triplets: [seed, source_tag, entity_tag]
  // TS seedLog is pairs: [seed, source_tag] where source_tag = entity logicIdx tag
  const wasmCalls = wasmStepResult.rngLog as Array<[number, number, number]>;
  const tsCalls = (tsLog?.seedLog ?? []) as Array<[number, number]>;

  console.log(`=== Tick 43 RNG attribution ===`);
  console.log(`WASM calls: ${wasmCalls.length}, TS calls: ${tsCalls.length}`);
  console.log(`Δ = ${wasmCalls.length - tsCalls.length} (WASM - TS)`);

  // Tag name helpers
  const wasmTagName = (tag: number): string => {
    if (tag >= 60000 && tag < 70000) return `foot[${tag}]`;
    if (tag >= 50000 && tag < 60000) return `combat[${tag}]`;
    if (tag >= 40000 && tag < 50000) return `aircraft[${tag}]`;
    if (tag >= 30000 && tag < 40000) return `animGate[${tag}]`;
    if (tag >= 16000) return `anim[${tag - 16000}]`;
    if (tag >= 15000) return `bullet[${tag - 15000}]`;
    if (tag >= 14000) return `vessel[${tag - 14000}]`;
    if (tag >= 13000) return `aircraftH[${tag - 13000}]`;
    if (tag >= 12000) return `building[${tag - 12000}]`;
    if (tag >= 11000) return `unit[${tag - 11000}]`;
    if (tag >= 10000) return `infantry[${tag - 10000}]`;
    if (tag === 200) return `Expert_AI`;
    if (tag === 1) return `TeamAI`;
    return `tag_${tag}`;
  };

  // Align and print per-call comparison
  const n = Math.max(wasmCalls.length, tsCalls.length);
  let lastMatch = -1;
  for (let i = 0; i < n; i++) {
    const w = wasmCalls[i];
    const t = tsCalls[i];
    const wSeed = w?.[0];
    const wSrc = w?.[1];
    const wEnt = w?.[2];
    const tSeed = t?.[0];
    const tSrc = t?.[1];

    if (w && t && wSeed === tSeed) {
      lastMatch = i;
    }
  }
  console.log(`Last matching index: ${lastMatch}`);

  // Show the divergence
  console.log(`\n--- Divergence at index ${lastMatch + 1} ---`);
  for (let i = Math.max(0, lastMatch - 2); i < Math.min(n, lastMatch + 5); i++) {
    const w = wasmCalls[i];
    const t = tsCalls[i];
    const wStr = w ? `W:[seed=${w[0]} src=${wasmTagName(w[1])} ent=${wasmTagName(w[2])}]` : 'W:(none)';
    const tStr = t ? `T:[seed=${t[0]} src=${wasmTagName(t[1])}]` : 'T:(none)';
    console.log(`  [${i}] ${wStr} ${tStr}`);
  }

  // Group WASM calls by entity_tag
  const wasmByEntity = new Map<number, Array<[number, number]>>();
  for (const [seed, src, ent] of wasmCalls) {
    if (!wasmByEntity.has(ent)) wasmByEntity.set(ent, []);
    wasmByEntity.get(ent)!.push([seed, src]);
  }
  // Group TS calls by source_tag (entity logicIdx)
  const tsByEntity = new Map<number, Array<[number, number]>>();
  for (const [seed, src] of tsCalls) {
    if (!tsByEntity.has(src)) tsByEntity.set(src, []);
    tsByEntity.get(src)!.push([seed, src]);
  }

  console.log(`\n--- WASM entities that fired RNG (${wasmByEntity.size}): ---`);
  for (const [ent, calls] of [...wasmByEntity.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${wasmTagName(ent)}: ${calls.length} calls`);
  }
  console.log(`\n--- TS entities that fired RNG (${tsByEntity.size}): ---`);
  for (const [ent, calls] of [...tsByEntity.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${wasmTagName(ent)}: ${calls.length} calls`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
