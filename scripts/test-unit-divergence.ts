import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG08EA unit divergence detail', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=SCG08EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=SCG08EA&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  // Step tick-by-tick, check every tick 150-400 for the initial divergence
  // Then every 30 ticks 400-800 for the enemy divergence
  let prevWU = 0, prevTU = 0, prevWE = 0, prevTE = 0;
  for (let t = 1; t <= 800; t++) {
    await Promise.all([
      (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 1); } catch {} })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1),
    ]);

    // Check every tick near divergence points, every 30 otherwise
    const nearDivergence = (t >= 150 && t <= 200) || (t >= 340 && t <= 380) || (t >= 520 && t <= 560);
    if (!nearDivergence && t % 30 !== 0 && t > 10) continue;

    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const units = (s.units || []).map((u: any) => ({ t: u.type, x: u.cx, y: u.cy, hp: u.hp, id: u.id }));
        const enemies = (s.enemies || []).map((u: any) => ({ t: u.type, x: u.cx, y: u.cy, hp: u.hp, id: u.id }));
        return { tick: s.tick, units, enemies, uc: s.units?.length ?? 0, ec: s.enemies?.length ?? 0 };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        const units = (s.units || []).map((u: any) => ({ t: u.type, x: u.cx, y: u.cy, hp: u.hp, id: u.id }));
        const enemies = (s.enemies || []).map((u: any) => ({ t: u.type, x: u.cx, y: u.cy, hp: u.hp, id: u.id }));
        return { tick: s.tick, units, enemies, uc: s.units?.length ?? 0, ec: s.enemies?.length ?? 0 };
      }),
    ]);

    const uChanged = w.uc !== prevWU || ts.uc !== prevTU;
    const eChanged = w.ec !== prevWE || ts.ec !== prevTE;

    if (uChanged || eChanged) {
      const uDelta = w.uc - ts.uc;
      const eDelta = w.ec - ts.ec;
      console.log('\nt' + t + ': units W=' + w.uc + ' T=' + ts.uc + ' (d=' + uDelta + ')  enemies W=' + w.ec + ' T=' + ts.ec + ' (d=' + eDelta + ')');

      if (uDelta !== 0) {
        // Find which units differ by type
        const wTypes: Record<string, number> = {};
        const tTypes: Record<string, number> = {};
        for (const u of w.units) wTypes[u.t] = (wTypes[u.t] || 0) + 1;
        for (const u of ts.units) tTypes[u.t] = (tTypes[u.t] || 0) + 1;
        const allTypes = new Set([...Object.keys(wTypes), ...Object.keys(tTypes)]);
        for (const type of allTypes) {
          const wc = wTypes[type] || 0;
          const tc = tTypes[type] || 0;
          if (wc !== tc) console.log('  unit ' + type + ': W=' + wc + ' T=' + tc);
        }
      }

      if (eDelta !== 0) {
        const wTypes: Record<string, number> = {};
        const tTypes: Record<string, number> = {};
        for (const u of w.enemies) wTypes[u.t] = (wTypes[u.t] || 0) + 1;
        for (const u of ts.enemies) tTypes[u.t] = (tTypes[u.t] || 0) + 1;
        const allTypes = new Set([...Object.keys(wTypes), ...Object.keys(tTypes)]);
        for (const type of allTypes) {
          const wc = wTypes[type] || 0;
          const tc = tTypes[type] || 0;
          if (wc !== tc) console.log('  enemy ' + type + ': W=' + wc + ' T=' + tc);
        }
      }
    }

    prevWU = w.uc; prevTU = ts.uc; prevWE = w.ec; prevTE = ts.ec;
  }

  await wasmCtx.close();
  await tsCtx.close();
});
