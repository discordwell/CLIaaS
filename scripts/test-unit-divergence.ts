import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG08EA: YAK spawn + AA trace', async ({ browser }) => {
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

  // Step to tick 355 in bulk
  await Promise.all([
    (async () => { let r = 355; while (r > 0) { const c = Math.min(r, 10); r -= c; try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, c); } catch { break; } } })(),
    tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 355),
  ]);

  // Now step tick-by-tick from 356 to 370, getting full detail on ALL units
  for (let t = 356; t <= 375; t++) {
    await Promise.all([
      (async () => { try { await wasmPage.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, 1); } catch {} })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, 1),
    ]);

    const [w, ts] = await Promise.all([
      wasmPage.evaluate(() => {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const enemies = (s.enemies || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        const units = (s.units || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        // Find AA-capable units (AGUN, SAM, or any with AA weapon)
        const aaUnits = units.filter((u: any) =>
          u.type === 'AGUN' || u.type === 'SAM' || u.type === 'E3' || u.type === 'E2');
        return { enemies, units, aaUnits, tick: s.tick };
      }),
      tsPage.evaluate(() => {
        const s = (window as any).__agentState();
        const enemies = (s.enemies || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        const units = (s.units || []).map((u: any) => ({
          id: u.id, type: u.type || u.t, hp: u.hp, maxHp: u.mhp,
          x: u.cx, y: u.cy, mission: u.mission
        }));
        const aaUnits = units.filter((u: any) =>
          u.type === 'AGUN' || u.type === 'SAM' || u.type === 'E3' || u.type === 'E2');
        return { enemies, units, aaUnits, tick: s.tick };
      }),
    ]);

    // Show YAKs specifically
    const wYaks = w.enemies.filter((e: any) => e.type === 'YAK');
    const tYaks = ts.enemies.filter((e: any) => e.type === 'YAK');

    console.log('\nt' + t + ': enemies W=' + w.enemies.length + ' T=' + ts.enemies.length);
    if (wYaks.length || tYaks.length) {
      console.log('  WASM YAKs:', wYaks.map((y: any) =>
        'id=' + y.id + ' hp=' + y.hp + '/' + y.maxHp + ' @(' + y.x + ',' + y.y + ') m=' + y.mission).join(' | ') || 'none');
      console.log('  TS   YAKs:', tYaks.map((y: any) =>
        'id=' + y.id + ' hp=' + y.hp + '/' + y.maxHp + ' @(' + y.x + ',' + y.y + ') m=' + y.mission).join(' | ') || 'none');
    }

    // Show AA-capable player units
    if (t === 356 || t === 360 || t === 361) {
      console.log('  WASM AA:', w.aaUnits.map((u: any) => u.type + ' @(' + u.x + ',' + u.y + ') hp=' + u.hp).join(' | '));
      console.log('  TS   AA:', ts.aaUnits.map((u: any) => u.type + ' @(' + u.x + ',' + u.y + ') hp=' + u.hp).join(' | '));
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
