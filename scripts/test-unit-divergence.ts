import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG03EA: unit count divergence trace', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(BASE_URL + '/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' }),
    tsPage.goto(BASE_URL + '?anttest=agent&scenario=SCG03EA&difficulty=normal', { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => { try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 120000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 }),
  ]);
  const seed = await wasmPage.evaluate(() => { const M = (window as any).Module; return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState; });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, seed);

  const getStates = async () => {
    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const mapAll = (arr: any[]) => (arr || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        return { units: mapAll(s.units), enemies: mapAll(s.enemies), tick: s.tick, credits: s.credits };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        const mapAll = (arr: any[]) => (arr || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        return { units: mapAll(s.units), enemies: mapAll(s.enemies), tick: s.tick, credits: s.credits };
      }),
    ]);
    return { w, ts };
  };

  const typeCounts = (arr: any[]) => {
    const c: Record<string, number> = {};
    for (const u of arr) c[u.type] = (c[u.type] || 0) + 1;
    return c;
  };

  const diffTypes = (wArr: any[], tArr: any[]) => {
    const wc = typeCounts(wArr);
    const tc = typeCounts(tArr);
    const allTypes = new Set([...Object.keys(wc), ...Object.keys(tc)]);
    const diffs: string[] = [];
    for (const t of allTypes) {
      if ((wc[t] || 0) !== (tc[t] || 0)) diffs.push(`${t}: W=${wc[t]||0} T=${tc[t]||0}`);
    }
    return diffs;
  };

  // Coarse scan to find divergence window
  console.log('=== COARSE SCAN: 10 ticks at a time to 600 ===');
  for (let batch = 0; batch < 60; batch++) {
    await Promise.all([
      (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 10); } catch {} })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 10),
    ]);
    const tick = (batch + 1) * 10;
    const { w, ts } = await getStates();
    const uDelta = w.units.length - ts.units.length;
    const eDelta = w.enemies.length - ts.enemies.length;
    if (uDelta !== 0 || eDelta !== 0 || tick % 100 === 0) {
      console.log(`t${tick}: units W=${w.units.length} T=${ts.units.length} (Δ${uDelta}), enemies W=${w.enemies.length} T=${ts.enemies.length} (Δ${eDelta})`);
      const ud = diffTypes(w.units, ts.units);
      const ed = diffTypes(w.enemies, ts.enemies);
      if (ud.length) console.log(`  Unit type diffs: ${ud.join(', ')}`);
      if (ed.length) console.log(`  Enemy type diffs: ${ed.join(', ')}`);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
