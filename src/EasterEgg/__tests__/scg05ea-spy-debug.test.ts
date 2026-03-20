import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA south path probe', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('probes cell-by-cell south from (14,64)', async () => {
    await adapter.loadScenario('SCG05EA');

    let state = (await adapter.step(1)).state;
    for (let i = 0; i < 40; i++) {
      state = (await adapter.step(15)).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;

    // Move to (14,64) first
    const setup = [
      { cx: 16, cy: 48 }, { cx: 14, cy: 55 }, { cx: 14, cy: 60 }, { cx: 14, cy: 64 },
    ];
    for (const wp of setup) {
      await adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: wp.cx, cy: wp.cy }]);
      for (let j = 0; j < 50; j++) {
        state = (await adapter.step(20)).state;
        const s = state.units.find(u => u.t === 'SPY');
        if (!s) { console.log('SPY DIED en route'); return; }
        if (Math.abs(s.cx - wp.cx) <= 1 && Math.abs(s.cy - wp.cy) <= 1) break;
      }
    }

    const spyNow = state.units.find(u => u.t === 'SPY')!;
    console.log(`Start: (${spyNow.cx},${spyNow.cy})`);

    // Probe southward 1 cell at a time
    for (let y = spyNow.cy + 1; y <= 110; y++) {
      const r = await adapter.step(200, [
        { cmd: 'move', unitIds: [spyNow.id], cx: spyNow.cx, cy: y },
      ]);
      const s = r.state.units.find(u => u.t === 'SPY');
      if (!s) { console.log(`  → (${spyNow.cx},${y}): SPY DIED`); break; }
      const moved = s.cy === y && Math.abs(s.cx - spyNow.cx) <= 1;
      console.log(`  → (${spyNow.cx},${y}): ${moved ? `OK at (${s.cx},${s.cy})` : `STUCK at (${s.cx},${s.cy})`}`);
      if (!moved) {
        // Try alternate x positions
        for (const altX of [13, 15, 16, 17, 18, 20, 22, 25, 30]) {
          const ar = await adapter.step(200, [
            { cmd: 'move', unitIds: [s.id], cx: altX, cy: y },
          ]);
          const as = ar.state.units.find(u => u.t === 'SPY');
          if (as && as.cy === y) {
            console.log(`    ALT (${altX},${y}): OK at (${as.cx},${as.cy})`);
            spyNow.cx = as.cx;
            spyNow.cy = as.cy;
            break;
          } else if (as) {
            console.log(`    ALT (${altX},${y}): STUCK at (${as.cx},${as.cy})`);
          }
        }
        if (spyNow.cy !== y) break;
        continue;
      }
      spyNow.cx = s.cx;
      spyNow.cy = s.cy;
    }

    expect(true).toBe(true);
  }, 300_000);
});
