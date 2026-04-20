import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

function decodeWasm(tag: number): string {
  if (tag === 1) return 'TeamAI';
  if (tag === 3) return 'Map.Logic';
  if (tag === 4) return 'FactoryAI';
  if (tag === 5) return 'HouseAI_preamble';
  if (tag === 20) return 'Do_Fade_AI';
  if (tag === 21) return 'LogicTrigger';
  if (tag >= 100 && tag < 200) return `House_AI[${tag}]`;
  if (tag === 30000) return 'MGA_Timer';
  if (tag === 30001) return 'MGA_RA_idle';
  if (tag === 30002) return 'MGA_RA_anim';
  if (tag === 30003) return 'MGA_RA_facing';
  if (tag === 40000) return 'Aircraft_AI';
  if (tag === 40001) return 'Aircraft_Heli_Scan';
  if (tag >= 40000 && tag < 41000) return `Aircraft[${tag-40000}]`;
  if (tag === 50000) return 'bridge_destroy';
  if (tag === 50001) return 'scorch_smudge';
  if (tag === 50002) return 'Coord_Scatter';
  if (tag === 60010) return 'MM_RP';
  if (tag === 60040) return 'MG_general';
  if (tag === 60041) return 'MG_vessel_DDPT';
  if (tag === 60042) return 'MG_vessel_CA';
  if (tag === 60043) return 'MG_inf_E1E3';
  if (tag === 60050) return 'MH_RP';
  if (tag === 60060) return 'ME_RP';
  if (tag === 60070) return 'MR_RP';
  if (tag === 60080) return 'Scatter_gate';
  if (tag === 60081) return 'Scatter_face_threat';
  if (tag === 60082) return 'Scatter_face_nothreat';
  if (tag === 60090) return 'Cloak_lowHP';
  if (tag === 60091) return 'Cloak_VIS';
  return `tag(${tag})`;
}

function decodeEntity(entTag: number): string {
  if (entTag >= 16000 && entTag < 20000) return `anim[${entTag - 16000}]`;
  if (entTag >= 15000 && entTag < 16000) return `bullet[${entTag - 15000}]`;
  if (entTag >= 14000 && entTag < 15000) return `vessel[${entTag - 14000}]`;
  if (entTag >= 13000 && entTag < 14000) return `aircraft[${entTag - 13000}]`;
  if (entTag >= 12000 && entTag < 13000) return `building[${entTag - 12000}]`;
  if (entTag >= 11000 && entTag < 12000) return `unit[${entTag - 11000}]`;
  if (entTag >= 10000 && entTag < 11000) return `infantry[${entTag - 10000}]`;
  return `ent(${entTag})`;
}

test('SCG06EA tick 0 RNG log side-by-side', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
  await tsPage.evaluate(() => { (window as any).__rngTagControl('enable'); });
  await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });

  // Skip to tick 13 first
  const skipTicks = Number(process.env.SKIP_TICKS ?? 0);
  if (skipTicks > 0) {
    await Promise.all([
      wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, skipTicks),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, skipTicks),
    ]);
    // Reset logs after skip
    await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      JSON.parse(M.ccall('agent_get_state','string',[],[]));
    });
    await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });
  }

  const [wasmStep] = await Promise.all([
    wasmPage.evaluate(async () => {
      const r = (window as any).__agentStep(1);
      const res = r?.then ? await r : r;
      const s = res?.state ?? res;
      return { log: s.rngLog as Array<[number, number, number]> };
    }),
    tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
  ]);
  const tsLog = await tsPage.evaluate(() => {
    const r = (window as any).__rngTagControl('read');
    return (r.seedLog ?? []) as Array<[number, number]>;
  });

  console.log(`=== TICK 0 RNG (WASM ${wasmStep.log.length} vs TS ${tsLog.length}) ===`);
  const maxLen = Math.max(wasmStep.log.length, tsLog.length);
  for (let i = 0; i < maxLen; i++) {
    const w = wasmStep.log[i];
    const t = tsLog[i];
    const wStr = w ? `s=${(w[0] >>> 0).toString().padStart(10)} ${decodeWasm(w[1]).padEnd(18)} ${decodeEntity(w[2])}` : '—';
    const tStr = t ? `s=${(t[0] >>> 0).toString().padStart(10)} ${decodeEntity(t[1])}` : '—';
    const match = w && t && (w[0] >>> 0) === (t[0] >>> 0);
    console.log(`[${String(i).padStart(3)}] ${match ? '✓' : '✗'} W: ${wStr} | TS: ${tStr}`);
  }

  await wasmCtx.close();
  await tsCtx.close();
});
