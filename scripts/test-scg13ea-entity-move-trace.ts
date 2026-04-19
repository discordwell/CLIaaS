/**
 * Track when the E1 USSR entity at cell (61,67) enters MOVE mode in WASM vs TS.
 * Expect TS and WASM to transition on different ticks (explaining tick-100 RNG gap).
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

test('SCG13EA E1 USSR (61,67) MOVE transition trace', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
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
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // Hunt specific TS entity id 109 (found in prior probe). WASM id may differ
  // so we'll match by type+house+close proximity.
  const track = async (tick: number) => {
    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const all = [...(s.units ?? []), ...(s.enemies ?? [])];
        // Find all E1 USSR near (61,67) — track the one we care about
        const near = all
          .filter((u: { t: string; house: string; cx: number; cy: number }) =>
            u.t === 'E1' && u.house === 'USSR' &&
            Math.abs(u.cx - 61) <= 3 && Math.abs(u.cy - 67) <= 3)
          .map((u: { id: number; cx: number; cy: number; m: number; mt: number }) => ({
            id: u.id, cx: u.cx, cy: u.cy, m: u.m, mt: u.mt,
          }));
        return near;
      }),
      tsPage.evaluate(() => {
        const game = (window as any).__agentGame;
        const near = game.entities
          .filter((e: { alive: boolean; type: string; house: string; cell: { cx: number; cy: number } }) =>
            e.alive && e.type === 'E1' && e.house === 'USSR' &&
            Math.abs(e.cell.cx - 61) <= 3 && Math.abs(e.cell.cy - 67) <= 3)
          .map((e: { id: number; cell: { cx: number; cy: number }; mission: string; missionTimer: number }) => ({
            id: e.id, cx: e.cell.cx, cy: e.cell.cy, m: e.mission, mt: e.missionTimer,
          }));
        return near;
      }),
    ]);
    return { w, ts };
  };

  let lastWASM = '';
  let lastTS = '';
  for (let t = 0; t <= 100; t++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const { w, ts } = await track(t + 1);
    const wStr = JSON.stringify(w);
    const tsStr = JSON.stringify(ts);
    if (wStr !== lastWASM || tsStr !== lastTS || t < 5 || t > 95) {
      console.log(`tick ${t + 1}:`);
      console.log(`  WASM: ${wStr}`);
      console.log(`  TS:   ${tsStr}`);
      lastWASM = wStr;
      lastTS = tsStr;
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
