import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA sprint attempt', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('sends spy through y=50 sprint and tracks dog positions', async () => {
    await adapter.loadScenario('SCG05EA');

    // Wait for spy
    let state = (await adapter.step(1)).state;
    for (let i = 0; i < 40; i++) {
      state = (await adapter.step(15)).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;
    console.log(`SPY at (${spy.cx},${spy.cy})`);

    // Move spy to staging point (21,48) via waypoints
    const setup = [
      { cx: 18, cy: 48 },
      { cx: 21, cy: 48 },
    ];
    for (const wp of setup) {
      await adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: wp.cx, cy: wp.cy }]);
      for (let i = 0; i < 30; i++) {
        state = (await adapter.step(15)).state;
        const s = state.units.find(u => u.t === 'SPY');
        if (!s) { console.log('SPY DIED during setup'); return; }
        if (Math.abs(s.cx - wp.cx) <= 1 && Math.abs(s.cy - wp.cy) <= 1) break;
      }
    }

    const spyNow = state.units.find(u => u.t === 'SPY')!;
    console.log(`\nSPY at staging: (${spyNow.cx},${spyNow.cy})`);

    // Log ALL dogs near the sprint corridor before sprinting
    const allDogs = state.enemies.filter(u => u.t === 'DOG');
    console.log(`\nAll dogs (${allDogs.length}):`);
    for (const d of allDogs) {
      const dist = Math.sqrt((d.cx - 26) ** 2 + (d.cy - 50) ** 2);
      if (dist < 15) {
        console.log(`  DOG(${d.cx},${d.cy}) h=${d.h} d_to_corridor=${dist.toFixed(1)}`);
      }
    }

    // NOW SPRINT: move spy south to y=50 then east
    console.log('\n=== SPRINTING ===');
    await adapter.step(1, [{ cmd: 'move', unitIds: [spyNow.id], cx: 30, cy: 50 }]);

    let lastCx = spyNow.cx, lastCy = spyNow.cy;
    for (let i = 0; i < 100; i++) {
      const r = await adapter.step(10);
      state = r.state;
      const s = state.units.find(u => u.t === 'SPY');
      if (!s) {
        console.log(`\n!!! SPY DIED tick=${state.tick} (was at ${lastCx},${lastCy})`);
        const nearDogs = state.enemies.filter(e => e.t === 'DOG' &&
          (e.cx - lastCx) ** 2 + (e.cy - lastCy) ** 2 <= 25);
        console.log(`Dogs near death: ${nearDogs.map(d => `(${d.cx},${d.cy})`).join(', ')}`);
        break;
      }
      if (s.cx !== lastCx || s.cy !== lastCy) {
        const nearDogs = state.enemies.filter(e => e.t === 'DOG' &&
          (e.cx - s.cx) ** 2 + (e.cy - s.cy) ** 2 <= 36);
        console.log(`  t=${state.tick} spy(${s.cx},${s.cy}) hp=${s.hp} dogs6=[${nearDogs.map(d => `(${d.cx},${d.cy})`).join(',')}]`);
        lastCx = s.cx; lastCy = s.cy;
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
