import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA spy flow', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('board → probe LST mobility → unload', async () => {
    await adapter.loadScenario('SCG05EA');

    // Wait for spy
    let state = (await adapter.step(1)).state;
    for (let i = 0; i < 40; i++) {
      state = (await adapter.step(15)).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;
    const lst = state.units.find(u => u.t === 'LST')!;
    console.log(`SPY (${spy.cx},${spy.cy}), LST (${lst.cx},${lst.cy}) cargo=${lst.cargo}`);

    // Board
    await adapter.step(1, [{ cmd: 'enter', unitId: spy.id, transportId: lst.id }]);
    state = (await adapter.step(15)).state;
    const lstB = state.units.find(u => u.t === 'LST')!;
    console.log(`After board: LST (${lstB.cx},${lstB.cy}) cargo=${lstB.cargo}`);

    // Probe LST mobility — try various destinations
    const probes = [
      { cx: 20, cy: 49 }, { cx: 25, cy: 50 }, { cx: 30, cy: 50 },
      { cx: 15, cy: 45 }, { cx: 15, cy: 55 }, { cx: 20, cy: 55 },
      { cx: 30, cy: 55 }, { cx: 35, cy: 55 }, { cx: 40, cy: 55 },
    ];
    for (const p of probes) {
      const r = await adapter.step(120, [
        { cmd: 'move', unitIds: [lstB.id], cx: p.cx, cy: p.cy },
      ]);
      const l = r.state.units.find(u => u.t === 'LST');
      console.log(`  LST → (${p.cx},${p.cy}): pos=(${l?.cx},${l?.cy}) m="${l?.m}"`);
    }

    // Try unloading where LST is
    const lstNow = state.units.find(u => u.t === 'LST');
    if (lstNow && (lstNow.cargo ?? 0) > 0) {
      console.log(`\nUnloading at (${lstNow.cx},${lstNow.cy})...`);
      const ur = await adapter.step(1, [{ cmd: 'deploy', unitId: lstNow.id }]);
      console.log(`  deploy result: ${ur.results.map(r => `${r.cmd}:${r.ok}:${r.error ?? 'ok'}`).join(', ')}`);
      state = (await adapter.step(15)).state;
      const spyOut = state.units.find(u => u.t === 'SPY');
      const lstAfter = state.units.find(u => u.t === 'LST');
      console.log(`  SPY: ${spyOut ? `(${spyOut.cx},${spyOut.cy})` : 'none'} LST cargo=${lstAfter?.cargo}`);
    }

    expect(true).toBe(true);
  }, 300_000);
});
