import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA pathfind debug', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('probes passability cell by cell from (20,48) eastward', async () => {
    await adapter.loadScenario('SCG05EA');

    // Wait for spy
    let state = (await adapter.step(1)).state;
    for (let i = 0; i < 40; i++) {
      state = (await adapter.step(15)).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;

    // Move spy to (20,48) via north corridor
    await adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: 18, cy: 48 }]);
    for (let i = 0; i < 30; i++) {
      state = (await adapter.step(15)).state;
      const s = state.units.find(u => u.t === 'SPY');
      if (!s) { console.log('SPY DIED'); return; }
      if (s.cx >= 18 && s.cy === 48) break;
    }

    await adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: 20, cy: 48 }]);
    for (let i = 0; i < 30; i++) {
      state = (await adapter.step(15)).state;
      const s = state.units.find(u => u.t === 'SPY');
      if (!s) { console.log('SPY DIED'); return; }
      if (s.cx >= 20 && s.cy === 48) break;
    }

    let spyNow = state.units.find(u => u.t === 'SPY')!;
    console.log(`Spy at (${spyNow.cx},${spyNow.cy})`);

    // Now try moving 1 cell at a time eastward
    for (let targetX = spyNow.cx + 1; targetX <= 35; targetX++) {
      const result = await adapter.step(120, [
        { cmd: 'move', unitIds: [spyNow.id], cx: targetX, cy: 48 },
      ]);
      state = result.state;
      const s = state.units.find(u => u.t === 'SPY');
      if (!s) { console.log(`  → (${targetX},48): SPY DIED`); break; }
      const moved = s.cx === targetX && s.cy === 48;
      const cmdOk = result.results.map(r => `${r.cmd}:${r.ok}`).join(',');
      console.log(`  → (${targetX},48): ${moved ? 'OK' : `STUCK at (${s.cx},${s.cy})`} cmd=${cmdOk} m="${s.m}" hp=${s.hp}`);
      if (!moved) {
        // Also try y=49 as alternative
        const alt = await adapter.step(120, [
          { cmd: 'move', unitIds: [s.id], cx: targetX, cy: 49 },
        ]);
        const s2 = alt.state.units.find(u => u.t === 'SPY');
        if (s2) {
          console.log(`    alt (${targetX},49): ${s2.cx === targetX ? 'OK' : `STUCK at (${s2.cx},${s2.cy})`}`);
        }
        // Try y=50
        const alt2 = await adapter.step(120, [
          { cmd: 'move', unitIds: [s.id], cx: targetX, cy: 50 },
        ]);
        const s3 = alt2.state.units.find(u => u.t === 'SPY');
        if (s3) {
          console.log(`    alt (${targetX},50): ${s3.cx === targetX ? 'OK' : `STUCK at (${s3.cx},${s3.cy})`}`);
        }
        break;
      }
      spyNow = s;
    }

    expect(true).toBe(true);
  }, 300_000);
});
